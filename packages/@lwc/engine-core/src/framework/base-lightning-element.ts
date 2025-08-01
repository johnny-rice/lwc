/*
 * Copyright (c) 2024, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */
/**
 * This module is responsible for producing the ComponentDef object that is always
 * accessible via `vm.def`. This is lazily created during the creation of the first
 * instance of a component class, and shared across all instances.
 *
 * This structure can be used to synthetically create proxies, and understand the
 * shape of a component. It is also used internally to apply extra optimizations.
 */
import {
    create,
    defineProperties,
    defineProperty,
    entries,
    freeze,
    isAPIFeatureEnabled,
    isFunction,
    isNull,
    isObject,
    isUndefined,
    KEY__SYNTHETIC_MODE,
    keys,
    setPrototypeOf,
    APIFeature,
    assert,
} from '@lwc/shared';

import { logError, logWarnOnce } from '../shared/logger';
import { getComponentTag } from '../shared/format';
import {
    ariaReflectionPolyfillDescriptors,
    propToAttrReflectionPolyfillDescriptors,
} from '../libs/reflection';

import { HTMLElementOriginalDescriptors } from './html-properties';
import { getComponentAPIVersion, getWrappedComponentsListener } from './component';
import { isBeingConstructed, isInvokingRender, vmBeingConstructed } from './invoker';
import { associateVM, getAssociatedVM, RenderMode, ShadowMode } from './vm';
import { componentValueObserved } from './mutation-tracker';
import {
    patchCustomElementWithRestrictions,
    patchShadowRootWithRestrictions,
} from './restrictions';
import { getVMBeingRendered, isUpdatingTemplate } from './template';
import { updateComponentValue } from './update-component-value';
import { markLockerLiveObject } from './membrane';
import { instrumentInstance } from './runtime-instrumentation';
import { applyShadowMigrateMode } from './shadow-migration-mode';
import type { HTMLElementConstructor } from './base-bridge-element';
import type { Template } from './template';
import type { RefVNodes, ShadowSupportMode, VM } from './vm';
import type { Stylesheets, AccessibleElementProperties } from '@lwc/shared';

/**
 * This operation is called with a descriptor of an standard html property
 * that a Custom Element can support (including AOM properties), which
 * determines what kind of capabilities the Base Lightning Element should support. When producing the new descriptors
 * for the Base Lightning Element, it also include the reactivity bit, so the standard property is reactive.
 * @param propName
 * @param descriptor
 */
function createBridgeToElementDescriptor(
    propName: string,
    descriptor: PropertyDescriptor
): PropertyDescriptor {
    const { get, set, enumerable, configurable } = descriptor;
    if (!isFunction(get)) {
        throw new TypeError(
            `Detected invalid public property descriptor for HTMLElement.prototype.${propName} definition. Missing the standard getter.`
        );
    }
    if (!isFunction(set)) {
        throw new TypeError(
            `Detected invalid public property descriptor for HTMLElement.prototype.${propName} definition. Missing the standard setter.`
        );
    }
    return {
        enumerable,
        configurable,
        get(this: LightningElement) {
            const vm = getAssociatedVM(this);
            if (isBeingConstructed(vm)) {
                if (process.env.NODE_ENV !== 'production') {
                    logError(
                        `The value of property \`${propName}\` can't be read from the constructor because the owner component hasn't set the value yet. Instead, use the constructor to set a default value for the property.`,
                        vm
                    );
                }
                return;
            }
            componentValueObserved(vm, propName);
            return get.call(vm.elm);
        },
        set(this: LightningElement, newValue: any) {
            const vm = getAssociatedVM(this);
            if (process.env.NODE_ENV !== 'production') {
                const vmBeingRendered = getVMBeingRendered();
                if (isInvokingRender) {
                    logError(
                        `${vmBeingRendered}.render() method has side effects on the state of ${vm}.${propName}`
                    );
                }
                if (isUpdatingTemplate) {
                    logError(
                        `When updating the template of ${vmBeingRendered}, one of the accessors used by the template has side effects on the state of ${vm}.${propName}`
                    );
                }
                if (isBeingConstructed(vm)) {
                    logError(
                        `Failed to construct '${getComponentTag(
                            vm
                        )}': The result must not have attributes.`
                    );
                }
                if (isObject(newValue) && !isNull(newValue)) {
                    logError(
                        `Invalid value "${newValue}" for "${propName}" of ${vm}. Value cannot be an object, must be a primitive value.`
                    );
                }
            }

            updateComponentValue(vm, propName, newValue);
            return set.call(vm.elm, newValue);
        },
    };
}

export interface LightningElementConstructor {
    new (): LightningElement;
    readonly prototype: LightningElement;
    readonly CustomElementConstructor: HTMLElementConstructor;

    delegatesFocus?: boolean;
    renderMode?: 'light' | 'shadow';
    formAssociated?: boolean;
    shadowSupportMode?: ShadowSupportMode;
    stylesheets: Stylesheets;
}

type HTMLElementTheGoodParts = { toString: () => string } & Pick<
    HTMLElement,
    | 'accessKey'
    | 'addEventListener'
    | 'attachInternals'
    | 'children'
    | 'childNodes'
    | 'classList'
    | 'dir'
    | 'dispatchEvent'
    | 'draggable'
    | 'firstChild'
    | 'firstElementChild'
    | 'getAttribute'
    | 'getAttributeNS'
    | 'getBoundingClientRect'
    | 'getElementsByClassName'
    | 'getElementsByTagName'
    | 'hasAttribute'
    | 'hasAttributeNS'
    | 'hidden'
    | 'id'
    | 'isConnected'
    | 'lang'
    | 'lastChild'
    | 'lastElementChild'
    | 'ownerDocument'
    | 'querySelector'
    | 'querySelectorAll'
    | 'removeAttribute'
    | 'removeAttributeNS'
    | 'removeEventListener'
    | 'setAttribute'
    | 'setAttributeNS'
    | 'shadowRoot'
    | 'spellcheck'
    | 'tabIndex'
    | 'tagName'
    | 'title'
    | 'style'
>;

type RefNodes = { [name: string]: Element };

const refsCache: WeakMap<RefVNodes, RefNodes> = new WeakMap();

export interface LightningElementShadowRoot extends ShadowRoot {
    /**
     * A `LightningElement` will always be attached to an [`HTMLElement`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement),
     * rather than the more broad `Element` used by the generic shadow root interface.
     */
    readonly host: HTMLElement;
    /**
     * When present, indicates that the shadow root is the synthetic polyfill loaded by
     * `@lwc/synethic-shadow`.
     */
    readonly synthetic?: true;
}

export interface LightningElement extends HTMLElementTheGoodParts, AccessibleElementProperties {
    constructor: LightningElementConstructor;
    template: LightningElementShadowRoot | null;
    refs: RefNodes | undefined;
    hostElement: Element;
    render(): Template;
    connectedCallback?(): void;
    disconnectedCallback?(): void;
    renderedCallback?(): void;
    errorCallback?(error: any, stack: string): void;
    formAssociatedCallback?(): void;
    formResetCallback?(): void;
    formDisabledCallback?(): void;
    formStateRestoreCallback?(): void;
}

/**
 * This class is the base class for any LWC element.
 * Some elements directly extends this class, others implement it via inheritance.
 */
// @ts-expect-error When exported, it will conform, but we need to build it first!
export const LightningElement: LightningElementConstructor = function (
    this: LightningElement
): LightningElement {
    // This should be as performant as possible, while any initialization should be done lazily
    if (isNull(vmBeingConstructed)) {
        // Thrown when doing something like `new LightningElement()` or
        // `class Foo extends LightningElement {}; new Foo()`
        throw new TypeError('Illegal constructor');
    }

    // This is a no-op unless Lightning DevTools are enabled.
    instrumentInstance(this, vmBeingConstructed);

    const vm = vmBeingConstructed;
    const { def, elm } = vm;
    const { bridge } = def;

    if (process.env.NODE_ENV !== 'production') {
        const { assertInstanceOfHTMLElement } = vm.renderer;
        assertInstanceOfHTMLElement(
            vm.elm,
            `Component creation requires a DOM element to be associated to ${vm}.`
        );
    }

    setPrototypeOf(elm, bridge.prototype);

    vm.component = this;

    // Locker hooks assignment. When the LWC engine run with Locker, Locker intercepts all the new
    // component creation and passes hooks to instrument all the component interactions with the
    // engine. We are intentionally hiding this argument from the formal API of LightningElement
    // because we don't want folks to know about it just yet.
    if (arguments.length === 1) {
        const { callHook, setHook, getHook } = arguments[0];
        vm.callHook = callHook;
        vm.setHook = setHook;
        vm.getHook = getHook;
    }

    markLockerLiveObject(this);

    // Linking elm, shadow root and component with the VM.
    associateVM(this, vm);
    associateVM(elm, vm);

    if (vm.renderMode === RenderMode.Shadow) {
        vm.renderRoot = doAttachShadow(vm);
    } else {
        vm.renderRoot = elm;
    }

    // Adding extra guard rails in DEV mode.
    if (process.env.NODE_ENV !== 'production') {
        patchCustomElementWithRestrictions(elm);
    }

    return this;
};

function doAttachShadow(vm: VM): LightningElementShadowRoot {
    const {
        elm,
        mode,
        shadowMode,
        def: { ctor },
        renderer: { attachShadow },
    } = vm;

    const shadowRoot = attachShadow(elm, {
        [KEY__SYNTHETIC_MODE]: shadowMode === ShadowMode.Synthetic,
        delegatesFocus: Boolean(ctor.delegatesFocus),
        mode,
    } as any);

    vm.shadowRoot = shadowRoot;
    associateVM(shadowRoot, vm);

    if (process.env.NODE_ENV !== 'production') {
        patchShadowRootWithRestrictions(shadowRoot);
    }

    if (
        process.env.IS_BROWSER &&
        lwcRuntimeFlags.ENABLE_FORCE_SHADOW_MIGRATE_MODE &&
        vm.shadowMigrateMode
    ) {
        applyShadowMigrateMode(shadowRoot);
    }

    return shadowRoot;
}

function warnIfInvokedDuringConstruction(vm: VM, methodOrPropName: string) {
    if (isBeingConstructed(vm)) {
        logError(
            `this.${methodOrPropName} should not be called during the construction of the custom element for ${getComponentTag(
                vm
            )} because the element is not yet in the DOM or has no children yet.`
        );
    }
}

// Type assertion because we need to build the prototype before it satisfies the interface.
(LightningElement as { prototype: Partial<LightningElement> }).prototype = {
    constructor: LightningElement,

    dispatchEvent(event: Event): boolean {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { dispatchEvent },
        } = vm;
        return dispatchEvent(elm, event);
    },

    addEventListener(
        type: string,
        listener: EventListener,
        options?: boolean | AddEventListenerOptions
    ): void {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { addEventListener },
        } = vm;

        if (process.env.NODE_ENV !== 'production') {
            const vmBeingRendered = getVMBeingRendered();
            if (isInvokingRender) {
                logError(
                    `${vmBeingRendered}.render() method has side effects on the state of ${vm} by adding an event listener for "${type}".`
                );
            }
            if (isUpdatingTemplate) {
                logError(
                    `Updating the template of ${vmBeingRendered} has side effects on the state of ${vm} by adding an event listener for "${type}".`
                );
            }
            if (!isFunction(listener)) {
                logError(
                    `Invalid second argument for this.addEventListener() in ${vm} for event "${type}". Expected an EventListener but received ${listener}.`
                );
            }
        }

        const wrappedListener = getWrappedComponentsListener(vm, listener);
        addEventListener(elm, type, wrappedListener, options);
    },

    removeEventListener(
        type: string,
        listener: EventListener,
        options?: boolean | AddEventListenerOptions
    ): void {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { removeEventListener },
        } = vm;

        const wrappedListener = getWrappedComponentsListener(vm, listener);
        removeEventListener(elm, type, wrappedListener, options);
    },

    hasAttribute(name: string): boolean {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { getAttribute },
        } = vm;
        return !isNull(getAttribute(elm, name));
    },

    hasAttributeNS(namespace: string | null, name: string): boolean {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { getAttribute },
        } = vm;
        return !isNull(getAttribute(elm, name, namespace));
    },

    removeAttribute(name: string): void {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { removeAttribute },
        } = vm;
        removeAttribute(elm, name);
    },

    removeAttributeNS(namespace: string | null, name: string): void {
        const {
            elm,
            renderer: { removeAttribute },
        } = getAssociatedVM(this);
        removeAttribute(elm, name, namespace);
    },

    getAttribute(name: string): string | null {
        const vm = getAssociatedVM(this);
        const { elm } = vm;
        const { getAttribute } = vm.renderer;
        return getAttribute(elm, name);
    },

    getAttributeNS(namespace: string | null, name: string): string | null {
        const vm = getAssociatedVM(this);
        const { elm } = vm;
        const { getAttribute } = vm.renderer;
        return getAttribute(elm, name, namespace);
    },

    setAttribute(name: string, value: string): void {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { setAttribute },
        } = vm;

        if (process.env.NODE_ENV !== 'production') {
            if (isBeingConstructed(vm)) {
                logError(
                    `Failed to construct '${getComponentTag(
                        vm
                    )}': The result must not have attributes.`
                );
            }
        }

        setAttribute(elm, name, value);
    },

    setAttributeNS(namespace: string | null, name: string, value: string): void {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { setAttribute },
        } = vm;

        if (process.env.NODE_ENV !== 'production') {
            if (isBeingConstructed(vm)) {
                logError(
                    `Failed to construct '${getComponentTag(
                        vm
                    )}': The result must not have attributes.`
                );
            }
        }

        setAttribute(elm, name, value, namespace);
    },

    getBoundingClientRect(): ClientRect {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { getBoundingClientRect },
        } = vm;

        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'getBoundingClientRect()');
        }

        return getBoundingClientRect(elm);
    },

    attachInternals(): ElementInternals {
        const vm = getAssociatedVM(this);
        const {
            elm,
            apiVersion,
            renderer: { attachInternals },
        } = vm;

        if (!isAPIFeatureEnabled(APIFeature.ENABLE_ELEMENT_INTERNALS_AND_FACE, apiVersion)) {
            throw new Error(
                `The attachInternals API is only supported in API version 61 and above. ` +
                    `The current version is ${apiVersion}. ` +
                    `To use this API, update the LWC component API version. https://lwc.dev/guide/versioning`
            );
        }

        if (vm.shadowMode === ShadowMode.Synthetic) {
            throw new Error('attachInternals API is not supported in synthetic shadow.');
        }

        return attachInternals(elm);
    },

    get isConnected(): boolean {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { isConnected },
        } = vm;
        return isConnected(elm);
    },

    get classList(): DOMTokenList {
        const vm = getAssociatedVM(this);
        const {
            elm,
            renderer: { getClassList },
        } = vm;

        if (process.env.NODE_ENV !== 'production') {
            if (isBeingConstructed(vm)) {
                logError(
                    `Failed to construct ${vm}: The result must not have attributes. Adding or tampering with classname in constructor is not allowed in a web component, use connectedCallback() instead.`
                );
            }
        }

        return getClassList(elm);
    },

    get template(): LightningElementShadowRoot | null {
        const vm = getAssociatedVM(this);

        if (process.env.NODE_ENV !== 'production') {
            if (vm.renderMode === RenderMode.Light) {
                logError(
                    '`this.template` returns null for light DOM components. Since there is no shadow, the rendered content can be accessed via `this` itself. e.g. instead of `this.template.querySelector`, use `this.querySelector`.'
                );
            }
        }

        return vm.shadowRoot;
    },

    get hostElement(): Element | undefined {
        const vm = getAssociatedVM(this);

        if (!process.env.IS_BROWSER) {
            assert.fail('this.hostElement is not supported in this environment');
        }

        const apiVersion = getComponentAPIVersion(vm.def.ctor);
        if (!isAPIFeatureEnabled(APIFeature.ENABLE_THIS_DOT_HOST_ELEMENT, apiVersion)) {
            if (process.env.NODE_ENV !== 'production') {
                logWarnOnce(
                    'The `this.hostElement` API within LightningElement is ' +
                        'only supported in API version 62 and above. Increase the API version to use it.'
                );
            }
            // Simulate the old behavior for `this.hostElement` to avoid a breaking change
            return undefined;
        }

        if (process.env.NODE_ENV !== 'production') {
            assert.isTrue(
                vm.elm instanceof Element,
                `this.hostElement should be an Element, found: ${vm.elm}`
            );
        }

        return vm.elm;
    },

    get refs(): RefNodes | undefined {
        const vm = getAssociatedVM(this);

        if (isUpdatingTemplate) {
            if (process.env.NODE_ENV !== 'production') {
                logError(
                    `this.refs should not be called while ${getComponentTag(
                        vm
                    )} is rendering. Use this.refs only when the DOM is stable, e.g. in renderedCallback().`
                );
            }
            // If the template is in the process of being updated, then we don't want to go through the normal
            // process of returning the refs and caching them, because the state of the refs is unstable.
            // This can happen if e.g. a template contains `<div class={foo}></div>` and `foo` is computed
            // based on `this.refs.bar`.
            return;
        }

        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'refs');
        }

        const { refVNodes, cmpTemplate } = vm;

        // If the `cmpTemplate` is null, that means that the template has not been rendered yet. Most likely this occurs
        // if `this.refs` is called during the `connectedCallback` phase. The DOM elements have not been rendered yet,
        // so log a warning. Note we also check `isBeingConstructed()` to avoid a double warning (due to
        // `warnIfInvokedDuringConstruction` above).
        if (
            process.env.NODE_ENV !== 'production' &&
            isNull(cmpTemplate) &&
            !isBeingConstructed(vm)
        ) {
            logError(
                `this.refs is undefined for ${getComponentTag(
                    vm
                )}. This is either because the attached template has no "lwc:ref" directive, or this.refs was ` +
                    `invoked before renderedCallback(). Use this.refs only when the referenced HTML elements have ` +
                    `been rendered to the DOM, such as within renderedCallback() or disconnectedCallback().`
            );
        }

        // For backwards compatibility with component written before template refs
        // were introduced, we return undefined if the template has no refs defined
        // anywhere. This fixes components that may want to add an expando called `refs`
        // and are checking if it exists with `if (this.refs)`  before adding it.
        // Note we use a null refVNodes to indicate that the template has no refs defined.
        if (isNull(refVNodes)) {
            return;
        }

        // The refNodes can be cached based on the refVNodes, since the refVNodes
        // are recreated from scratch every time the template is rendered.
        // This happens with `vm.refVNodes = null` in `template.ts` in `@lwc/engine-core`.
        let refs = refsCache.get(refVNodes);

        if (isUndefined(refs)) {
            refs = create(null) as RefNodes;
            for (const key of keys(refVNodes)) {
                refs[key] = refVNodes[key].elm!;
            }
            freeze(refs);
            refsCache.set(refVNodes, refs);
        }

        return refs;
    },

    // For backwards compat, we allow component authors to set `refs` as an expando
    set refs(value: any) {
        defineProperty(this, 'refs', {
            configurable: true,
            enumerable: true,
            writable: true,
            value,
        });
    },

    get shadowRoot(): null {
        // From within the component instance, the shadowRoot is always reported as "closed".
        // Authors should rely on this.template instead.
        return null;
    },

    get children() {
        const vm = getAssociatedVM(this);
        const renderer = vm.renderer;
        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'children');
        }
        return renderer.getChildren(vm.elm);
    },

    get childNodes() {
        const vm = getAssociatedVM(this);
        const renderer = vm.renderer;
        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'childNodes');
        }
        // getChildNodes returns a NodeList, which has `item(index: number): Node | null`.
        // NodeListOf<T> extends NodeList, but claims to not return null. That seems inaccurate,
        // but these are built-in types, so ultimately not our problem.
        return renderer.getChildNodes(vm.elm) as NodeListOf<ChildNode>;
    },

    get firstChild() {
        const vm = getAssociatedVM(this);
        const renderer = vm.renderer;
        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'firstChild');
        }
        return renderer.getFirstChild(vm.elm);
    },

    get firstElementChild() {
        const vm = getAssociatedVM(this);
        const renderer = vm.renderer;
        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'firstElementChild');
        }
        return renderer.getFirstElementChild(vm.elm);
    },

    get lastChild() {
        const vm = getAssociatedVM(this);
        const renderer = vm.renderer;
        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'lastChild');
        }
        return renderer.getLastChild(vm.elm);
    },

    get lastElementChild() {
        const vm = getAssociatedVM(this);
        const renderer = vm.renderer;
        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'lastElementChild');
        }
        return renderer.getLastElementChild(vm.elm);
    },

    get ownerDocument() {
        const vm = getAssociatedVM(this);
        const renderer = vm.renderer;
        if (process.env.NODE_ENV !== 'production') {
            warnIfInvokedDuringConstruction(vm, 'ownerDocument');
        }
        return renderer.ownerDocument(vm.elm);
    },

    get tagName() {
        const { elm, renderer } = getAssociatedVM(this);
        return renderer.getTagName(elm);
    },

    get style() {
        const { elm, renderer, def } = getAssociatedVM(this);
        const apiVersion = getComponentAPIVersion(def.ctor);
        if (!isAPIFeatureEnabled(APIFeature.ENABLE_THIS_DOT_STYLE, apiVersion)) {
            if (process.env.NODE_ENV !== 'production') {
                logWarnOnce(
                    'The `this.style` API within LightningElement returning the CSSStyleDeclaration is ' +
                        'only supported in API version 62 and above. Increase the API version to use it.'
                );
            }
            // Simulate the old behavior for `this.style` to avoid a breaking change
            return undefined;
        }
        return renderer.getStyle(elm);
    },

    render(): Template {
        const vm = getAssociatedVM(this);
        return vm.def.template;
    },

    toString(): string {
        const vm = getAssociatedVM(this);
        return `[object ${vm.def.name}]`;
    },
};

const queryAndChildGetterDescriptors: PropertyDescriptorMap = create(null);

const queryMethods = [
    'getElementsByClassName',
    'getElementsByTagName',
    'querySelector',
    'querySelectorAll',
] as const;

// Generic passthrough for query APIs on HTMLElement to the relevant Renderer APIs
for (const queryMethod of queryMethods) {
    queryAndChildGetterDescriptors[queryMethod] = {
        value(this: LightningElement, arg: string) {
            const vm = getAssociatedVM(this);
            const { elm, renderer } = vm;

            if (process.env.NODE_ENV !== 'production') {
                warnIfInvokedDuringConstruction(vm, `${queryMethod}()`);
            }

            return renderer[queryMethod](elm, arg);
        },
        configurable: true,
        enumerable: true,
        writable: true,
    };
}

defineProperties(LightningElement.prototype, queryAndChildGetterDescriptors);

export const lightningBasedDescriptors: PropertyDescriptorMap = create(null);
for (const propName in HTMLElementOriginalDescriptors) {
    lightningBasedDescriptors[propName] = createBridgeToElementDescriptor(
        propName,
        HTMLElementOriginalDescriptors[propName]
    );
}

// Apply ARIA reflection to LightningElement.prototype, on both the browser and server.
// This allows `this.aria*` property accessors to work from inside a component, and to reflect `aria-*` attrs.
// Note this works regardless of whether the global ARIA reflection polyfill is applied or not.
if (process.env.IS_BROWSER) {
    // In the browser, we use createBridgeToElementDescriptor, so we can get the normal reactivity lifecycle for
    // aria* properties
    for (const [propName, descriptor] of entries(ariaReflectionPolyfillDescriptors) as [
        name: string,
        descriptor: PropertyDescriptor,
    ][]) {
        lightningBasedDescriptors[propName] = createBridgeToElementDescriptor(propName, descriptor);
    }
} else {
    // On the server, we cannot use createBridgeToElementDescriptor because getAttribute/setAttribute are
    // not supported on HTMLElement. So apply the polyfill directly on top of LightningElement
    defineProperties(LightningElement.prototype, propToAttrReflectionPolyfillDescriptors);
}

defineProperties(LightningElement.prototype, lightningBasedDescriptors);

defineProperty(LightningElement, 'CustomElementConstructor', {
    get() {
        // If required, a runtime-specific implementation must be defined.
        throw new ReferenceError('The current runtime does not support CustomElementConstructor.');
    },
    configurable: true,
});
