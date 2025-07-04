/*
 * Copyright (c) 2025, Salesforce, Inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */
import { walk } from 'estree-walker';
import {
    getAPIVersionFromNumber,
    SVG_NAMESPACE,
    STATIC_PART_TOKEN_ID,
    isUndefined,
    APIFeature,
    isAPIFeatureEnabled,
} from '@lwc/shared';

import * as t from '../shared/estree';
import { LWCDirectiveRenderMode } from '../shared/types';
import {
    PARSE_FRAGMENT_METHOD_NAME,
    PARSE_SVG_FRAGMENT_METHOD_NAME,
    TEMPLATE_PARAMS,
} from '../shared/constants';
import {
    isAttribute,
    isBooleanLiteral,
    isComment,
    isElement,
    isExpression,
    isKeyDirective,
    isPreserveCommentsDirective,
    isRenderModeDirective,
    isStringLiteral,
} from '../shared/ast';
import { isArrayExpression } from '../shared/estree';
import {
    isAllowedFragOnlyUrlsXHTML,
    isFragmentOnlyUrl,
    isIdReferencingAttribute,
    isSvgUseHref,
} from '../parser/attribute';
import { getMemberExpressionRoot, objectToAST } from './helpers';
import {
    transformStaticChildren,
    getStaticNodes,
    isContiguousText,
    hasDynamicText,
} from './static-element';
import { serializeStaticElement } from './static-element-serializer';
import { bindAttributeExpression, bindComplexExpression } from './expression';
import type State from '../state';
import type {
    ChildNode,
    Expression,
    ComplexExpression,
    Literal,
    Root,
    EventListener,
    RefDirective,
    Text,
    StaticElement,
    Attribute,
    KeyDirective,
    StaticChildNode,
    OnDirective,
} from '../shared/types';
import type { APIVersion } from '@lwc/shared';
import type { Node } from 'estree-walker';

type RenderPrimitive =
    | 'iterator'
    | 'flatten'
    | 'element'
    | 'slot'
    | 'customElement'
    | 'bind'
    | 'text'
    | 'dynamicText'
    | 'dynamicCtor'
    | 'deprecatedDynamicCtor'
    | 'key'
    | 'tabindex'
    | 'scopedId'
    | 'scopedFragId'
    | 'comment'
    | 'sanitizeHtmlContent'
    | 'fragment'
    | 'staticFragment'
    | 'scopedSlotFactory'
    | 'staticPart'
    | 'normalizeClassName';

interface RenderPrimitiveDefinition {
    name: string;
    alias: string;
}

const RENDER_APIS: { [primitive in RenderPrimitive]: RenderPrimitiveDefinition } = {
    bind: { name: 'b', alias: 'api_bind' },
    comment: { name: 'co', alias: 'api_comment' },
    customElement: { name: 'c', alias: 'api_custom_element' },
    // TODO [#3331]: remove usage of lwc:dynamic in 246
    deprecatedDynamicCtor: { name: 'ddc', alias: 'api_deprecated_dynamic_component' },
    dynamicCtor: { name: 'dc', alias: 'api_dynamic_component' },
    dynamicText: { name: 'd', alias: 'api_dynamic_text' },
    element: { name: 'h', alias: 'api_element' },
    flatten: { name: 'f', alias: 'api_flatten' },
    fragment: { name: 'fr', alias: 'api_fragment' },
    iterator: { name: 'i', alias: 'api_iterator' },
    key: { name: 'k', alias: 'api_key' },
    sanitizeHtmlContent: { name: 'shc', alias: 'api_sanitize_html_content' },
    scopedFragId: { name: 'fid', alias: 'api_scoped_frag_id' },
    scopedId: { name: 'gid', alias: 'api_scoped_id' },
    scopedSlotFactory: { name: 'ssf', alias: 'api_scoped_slot_factory' },
    slot: { name: 's', alias: 'api_slot' },
    staticFragment: { name: 'st', alias: 'api_static_fragment' },
    staticPart: { name: 'sp', alias: 'api_static_part' },
    tabindex: { name: 'ti', alias: 'api_tab_index' },
    text: { name: 't', alias: 'api_text' },
    normalizeClassName: { name: 'ncls', alias: 'api_normalize_class_name' },
};

interface Scope {
    parent: Scope | null;
    declaration: Set<string>;
}

export default class CodeGen {
    /** The AST root. */
    readonly root: Root;

    /** The template render mode. */
    readonly renderMode: LWCDirectiveRenderMode;

    /** Indicates whether the generated code should preserve HTML comments or not. */
    readonly preserveComments: boolean;

    /**
     * This flag indicates if the generated code should scope the template fragment id. It is set to
     * true if the template also contains ids.
     *
     * TODO [#1150]: Remove this code once we can figure out how to do this in a deterministic
     * fashion.
     */
    readonly scopeFragmentId: boolean;

    /**
     * The scope keeps track of the identifiers that have been seen while traversing the AST.
     * Currently, we are keeping track of item, index and iterator on the ForEach and ForOf nodes respectively.
     *
     * Scope is used in bindExpression to determine if the expression is a known identifier.
     * A known identifier exists if it exists in the scope chain.
     */
    private scope: Scope;

    readonly staticNodes: Set<ChildNode> = new Set<ChildNode>();
    readonly hoistedNodes: Array<{ identifier: t.Identifier; expr: t.Expression }> = [];

    /** True if this template contains the lwc:ref directive */
    hasRefs: boolean = false;

    /**
     * State maintains information about the current compilation configs.
     */
    readonly state: State;

    /**
     * True if this is a synthetic shadow template - otherwise, we may apply certain optimizations
     * that only exist for native shadow and light DOM.
     */
    readonly isSyntheticShadow: boolean;

    currentId = 0;
    currentKey = 0;
    innerHtmlInstances = 0;

    usedApis: { [name: string]: t.Identifier } = {};
    usedLwcApis: Set<string> = new Set();

    slotNames: Set<string> = new Set();
    memoizedIds: t.Identifier[] = [];
    referencedComponents: Set<string> = new Set();
    apiVersion: APIVersion;

    staticExpressionMap = new WeakMap<Attribute | Text, string>();

    constructor({
        root,
        state,
        scopeFragmentId,
    }: {
        root: Root;
        state: State;
        scopeFragmentId: boolean;
    }) {
        this.root = root;

        if (state.config.enableStaticContentOptimization) {
            this.staticNodes = getStaticNodes(root, state);
        }
        this.renderMode =
            root.directives.find(isRenderModeDirective)?.value.value ??
            LWCDirectiveRenderMode.shadow;
        this.preserveComments =
            root.directives.find(isPreserveCommentsDirective)?.value.value ??
            state.config.preserveHtmlComments;

        this.scopeFragmentId = scopeFragmentId;
        this.scope = this.createScope();
        this.state = state;
        this.apiVersion = getAPIVersionFromNumber(state.config.apiVersion);

        this.isSyntheticShadow =
            this.renderMode !== LWCDirectiveRenderMode.light &&
            !this.state.config.disableSyntheticShadowSupport;
    }

    generateKey() {
        return this.currentKey++;
    }

    genElement(tagName: string, data: t.ObjectExpression, children: t.Expression) {
        const args: t.Expression[] = [t.literal(tagName), data];
        if (!isArrayExpression(children) || children.elements.length > 0) {
            args.push(children); // only generate children if non-empty
        }
        return this._renderApiCall(RENDER_APIS.element, args);
    }

    genCustomElement(
        tagName: string,
        componentClass: t.Identifier,
        data: t.ObjectExpression,
        children: t.Expression
    ) {
        this.referencedComponents.add(tagName);

        const args: t.Expression[] = [t.literal(tagName), componentClass, data];
        if (!isArrayExpression(children) || children.elements.length > 0) {
            args.push(children); // only generate children if non-empty
        }

        return this._renderApiCall(RENDER_APIS.customElement, args);
    }

    genDynamicElement(ctor: t.Expression, data: t.ObjectExpression, children: t.Expression) {
        const args: t.Expression[] = [ctor, data];
        if (!isArrayExpression(children) || children.elements.length > 0) {
            args.push(children); // only generate children if non-empty
        }

        return this._renderApiCall(RENDER_APIS.dynamicCtor, args);
    }

    genDeprecatedDynamicElement(
        tagName: string,
        ctor: t.Expression,
        data: t.ObjectExpression,
        children: t.Expression
    ) {
        const args: t.Expression[] = [t.literal(tagName), ctor, data];
        if (!isArrayExpression(children) || children.elements.length > 0) {
            args.push(children); // only generate children if non-empty
        }

        return this._renderApiCall(RENDER_APIS.deprecatedDynamicCtor, args);
    }

    genText(value: Array<string | t.Expression>): t.Expression {
        return this._renderApiCall(RENDER_APIS.text, [this.genConcatenatedText(value)]);
    }

    genConcatenatedText(value: Array<string | t.Expression>): t.Expression {
        const mappedValues = value.map((v) => {
            return typeof v === 'string'
                ? t.literal(v)
                : this._renderApiCall(RENDER_APIS.dynamicText, [v]);
        });

        let textConcatenation: t.Expression = mappedValues[0];

        for (let i = 1, n = mappedValues.length; i < n; i++) {
            textConcatenation = t.binaryExpression('+', textConcatenation, mappedValues[i]);
        }
        return textConcatenation;
    }

    genComment(value: string): t.Expression {
        return this._renderApiCall(RENDER_APIS.comment, [t.literal(value)]);
    }

    genSanitizeHtmlContent(content: t.Expression): t.Expression {
        return this._renderApiCall(RENDER_APIS.sanitizeHtmlContent, [content]);
    }

    genFragment(
        key: t.Expression | t.SimpleLiteral,
        children: t.Expression,
        stable: boolean = false
    ): t.Expression {
        const isStable = stable ? t.literal(1) : t.literal(0);
        return this._renderApiCall(RENDER_APIS.fragment, [key, children, isStable]);
    }

    genIterator(iterable: t.Expression, callback: t.FunctionExpression) {
        return this._renderApiCall(RENDER_APIS.iterator, [iterable, callback]);
    }

    genBind(handler: t.Expression) {
        return this._renderApiCall(RENDER_APIS.bind, [handler]);
    }

    genFlatten(children: t.Expression[]) {
        return this._renderApiCall(RENDER_APIS.flatten, children);
    }

    genScopedId(id: string | t.Expression): t.Expression | t.Literal {
        const value = typeof id === 'string' ? t.literal(id) : id;
        return this.isSyntheticShadow ? this._renderApiCall(RENDER_APIS.scopedId, [value]) : value;
    }

    genScopedFragId(id: string | t.Expression): t.Expression | t.Literal {
        const value = typeof id === 'string' ? t.literal(id) : id;
        return this.isSyntheticShadow
            ? this._renderApiCall(RENDER_APIS.scopedFragId, [value])
            : value;
    }

    genClassExpression(value: Expression) {
        let classExpression = this.bindExpression(value);
        const isClassNameObjectBindingEnabled = isAPIFeatureEnabled(
            APIFeature.TEMPLATE_CLASS_NAME_OBJECT_BINDING,
            this.state.config.apiVersion
        );
        if (isClassNameObjectBindingEnabled) {
            classExpression = this.genNormalizeClassName(classExpression);
        }
        return classExpression;
    }

    genNormalizeClassName(className: t.Expression): t.CallExpression {
        return this._renderApiCall(RENDER_APIS.normalizeClassName, [className]);
    }

    /**
     * Generates childs vnodes when slot content is static.
     * @param slotName
     * @param data
     * @param children
     */
    getSlot(slotName: string, data: t.ObjectExpression, children: t.Expression) {
        this.slotNames.add(slotName);

        return this._renderApiCall(RENDER_APIS.slot, [
            t.literal(slotName),
            data,
            children,
            t.identifier('$slotset'),
        ]);
    }

    /**
     * Generates a factory function that inturn generates child vnodes for scoped slot content.
     * @param callback
     * @param slotName
     */
    getScopedSlotFactory(callback: t.FunctionExpression, slotName: t.Expression | t.SimpleLiteral) {
        return this._renderApiCall(RENDER_APIS.scopedSlotFactory, [slotName, callback]);
    }

    genTabIndex(children: [t.Expression]) {
        return this._renderApiCall(RENDER_APIS.tabindex, children);
    }

    getMemoizationId() {
        const currentId = this.currentId++;
        const memoizationId = t.identifier(`_m${currentId}`);

        this.memoizedIds.push(memoizationId);

        return memoizationId;
    }

    genBooleanAttributeExpr(bindExpr: t.Expression) {
        return t.conditionalExpression(bindExpr, t.literal(''), t.literal(null));
    }

    genEventListeners(listeners: EventListener[]) {
        let hasLocalListeners = false;

        const listenerObj: Record<string, { handler: t.Expression; isLocal: boolean }> = {};

        for (const { name, handler } of listeners) {
            const componentHandler = this.bindExpression(handler) as t.MemberExpression;
            const id = getMemberExpressionRoot(componentHandler);
            const isLocal = this.isLocalIdentifier(id);

            if (isLocal) {
                hasLocalListeners = true;
            }

            listenerObj[name] = { handler: this.genBind(componentHandler), isLocal };
        }

        // Individually memoize a non-local event handler
        // Example input: <template for:each={list} for:item="task">
        //                  <button [...] ontouchstart={foo}>[X]</button>
        //                </template>
        // Output: [...] touchstart: _m2 || ($ctx._m2 = api_bind($cmp.foo))
        const memoize = (expr: t.Expression) => {
            const memoizedId = this.getMemoizationId();
            return t.logicalExpression(
                '||',
                memoizedId,
                t.assignmentExpression(
                    '=',
                    t.memberExpression(t.identifier(TEMPLATE_PARAMS.CONTEXT), memoizedId),
                    expr
                )
            );
        };

        if (hasLocalListeners) {
            // If there are local listeners, we need to memoize individual handlers
            // Input: <template for:each={list} for:item="task">
            //          <button onclick={task.delete} ontouchstart={foo}>[X]</button>
            //        </template>
            // Output:
            //   on: {
            //     click: api_bind(task.delete),
            //     touchstart: _m2 || ($ctx._m2 = api_bind($cmp.foo))
            //   }
            return t.property(
                t.identifier('on'),
                objectToAST(listenerObj, (k) => {
                    const { isLocal, handler } = listenerObj[k];
                    return isLocal ? handler : memoize(handler);
                })
            );
        } else {
            // If there are no local listeners, we can memoize the entire `on` object
            // Input: <template>
            //          <button onclick={create}>New</button>
            //        </template>
            // Output: on: _m1 || ($ctx._m1 = { click: api_bind($cmp.create) })
            return t.property(
                t.identifier('on'),
                memoize(objectToAST(listenerObj, (k) => listenerObj[k].handler))
            );
        }
    }

    genDynamicEventListeners(onDirective: OnDirective) {
        // Example Input : lwc:on={someObj}

        // $cmp.someObj
        const rawValue = this.bindExpression(onDirective.value);

        // {__proto__: null, ...$cmp.someObj}
        const clonedValue = t.objectExpression([
            t.property(t.identifier('__proto__'), t.literal(null)),
            t.spreadElement(rawValue),
        ]);

        const dynamicOnRawProperty = t.property(t.identifier('dynamicOnRaw'), rawValue);

        const dynamicOnProperty = t.property(t.identifier('dynamicOn'), clonedValue);

        return [dynamicOnRawProperty, dynamicOnProperty];
    }

    genRef(ref: RefDirective) {
        this.hasRefs = true;
        return t.property(t.identifier('ref'), ref.value);
    }

    genKeyExpression(ref: KeyDirective | undefined, slotParentName: string | undefined) {
        if (ref) {
            // If element has user-supplied `key` or is in iterator, call `api.k`
            const forKeyExpression = this.bindExpression(ref.value);
            const key = this.generateKey();
            return this._renderApiCall(RENDER_APIS.key, [t.literal(key), forKeyExpression]);
        } else {
            // If standalone element with no user-defined key
            let key: number | string = this.generateKey();
            // Parent slot name could be the empty string
            if (slotParentName !== undefined) {
                // Prefixing the key is necessary to avoid conflicts with default content for the
                // slot which might have similar keys. Each vnode will always have a key that starts
                // with a numeric character from compiler. In this case, we add a unique notation
                // for slotted vnodes keys, e.g.: `@foo:1:1`. Note that this is *not* needed for
                // dynamic keys, since `api.k` already scopes based on the iteration.
                key = `@${slotParentName}:${key}`;
            }
            return t.literal(key);
        }
    }

    /**
     * This routine generates an expression that avoids
     * computing the sanitized html of a raw html if it does not change
     * between renders.
     * @param expr
     * @returns The generated expression
     */
    genSanitizedHtmlExpr(expr: t.Expression) {
        const instance = this.innerHtmlInstances++;

        // Optimization for static html.
        // Example input: <div lwc:inner-html="foo">
        // Output: $ctx._sanitizedHtml$0 || ($ctx._sanitizedHtml$0 = api_sanitize_html_content("foo"))
        if (t.isLiteral(expr)) {
            return t.logicalExpression(
                '||',
                t.memberExpression(
                    t.identifier(TEMPLATE_PARAMS.CONTEXT),
                    t.identifier(`_sanitizedHtml$${instance}`)
                ),
                t.assignmentExpression(
                    '=',
                    t.memberExpression(
                        t.identifier(TEMPLATE_PARAMS.CONTEXT),
                        t.identifier(`_sanitizedHtml$${instance}`)
                    ),
                    this.genSanitizeHtmlContent(expr)
                )
            );
        }

        // Example input: <div lwc:inner-html={foo}>
        // Output: $ctx._rawHtml$0 !== ($ctx._rawHtml$0 = $cmp.foo)
        //             ? ($ctx._sanitizedHtml$0 = api_sanitize_html_content($cmp.foo))
        //             : $ctx._sanitizedHtml$0
        //
        // Note: In the case of iterations, when the lwc:inner-html bound value depends on the
        //       iteration item, the generated expression won't be enough, and `sanitizeHtmlContent`
        //       will be called every time because this expression is based on the specific template
        //       usage of the lwc:inner-html, and in an iteration, usages are dynamically generated.
        return t.conditionalExpression(
            t.binaryExpression(
                '!==',
                t.memberExpression(
                    t.identifier(TEMPLATE_PARAMS.CONTEXT),
                    t.identifier(`_rawHtml$${instance}`)
                ),
                t.assignmentExpression(
                    '=',
                    t.memberExpression(
                        t.identifier(TEMPLATE_PARAMS.CONTEXT),
                        t.identifier(`_rawHtml$${instance}`)
                    ),
                    expr
                )
            ),
            t.assignmentExpression(
                '=',
                t.memberExpression(
                    t.identifier(TEMPLATE_PARAMS.CONTEXT),
                    t.identifier(`_sanitizedHtml$${instance}`)
                ),
                this.genSanitizeHtmlContent(expr)
            ),
            t.memberExpression(
                t.identifier(TEMPLATE_PARAMS.CONTEXT),
                t.identifier(`_sanitizedHtml$${instance}`)
            )
        );
    }

    private _renderApiCall(
        primitive: RenderPrimitiveDefinition,
        params: t.Expression[]
    ): t.CallExpression {
        const { name, alias } = primitive;

        let identifier = this.usedApis[name];
        if (!identifier) {
            identifier = this.usedApis[name] = t.identifier(alias);
        }

        return t.callExpression(identifier, params);
    }

    beginScope(): void {
        this.scope = this.createScope(this.scope);
    }

    private createScope(parent: Scope | null = null): Scope {
        return {
            parent,
            declaration: new Set(),
        };
    }

    endScope(): void {
        /* istanbul ignore if */
        if (!this.scope.parent) {
            throw new Error("Can't invoke endScope if the current scope has no parent");
        }

        this.scope = this.scope.parent;
    }

    declareIdentifier(identifier: t.Identifier): void {
        this.scope.declaration.add(identifier.name);
    }

    /**
     * Searches the scopes to find an identifier with a matching name.
     * @param identifier
     */
    isLocalIdentifier(identifier: t.Identifier): boolean {
        let scope: Scope | null = this.scope;

        while (scope !== null) {
            if (scope.declaration.has(identifier.name)) {
                return true;
            }

            scope = scope.parent;
        }

        return false;
    }

    /**
     * Bind the passed expression to the component instance. It applies the following transformation to the expression:
     * - {value} --> {$cmp.value}
     * - {value[index]} --> {$cmp.value[$cmp.index]}
     * @param expression
     */
    bindExpression(expression: Expression | Literal | ComplexExpression): t.Expression {
        if (t.isIdentifier(expression)) {
            if (!this.isLocalIdentifier(expression)) {
                return t.memberExpression(t.identifier(TEMPLATE_PARAMS.INSTANCE), expression);
            } else {
                return expression;
            }
        }

        // TODO [#3370]: remove experimental template expression flag
        if (this.state.config.experimentalComplexExpressions) {
            // Cloning here is necessary because `this.replace()` is destructive, and we might use the
            // node later during static content optimization
            expression = structuredClone(expression);
            return bindComplexExpression(expression as ComplexExpression, this);
        }

        // We need access to both this `this` and the walker's `this` in the walker
        // eslint-disable-next-line @typescript-eslint/no-this-alias
        const scope = this;

        // Cloning here is necessary because `this.replace()` is destructive, and we might use the
        // node later during static content optimization
        expression = structuredClone(expression);
        // TODO [#3370]: when the template expression flag is removed, the
        // ComplexExpression type should be redefined as an ESTree Node. Doing
        // so when the flag is still in place results in a cascade of required
        // type changes across the codebase.
        walk(expression as Node, {
            leave(node, parent) {
                if (
                    parent !== null &&
                    t.isIdentifier(node) &&
                    t.isMemberExpression(parent) &&
                    parent.object === node &&
                    !scope.isLocalIdentifier(node)
                ) {
                    this.replace(
                        t.memberExpression(t.identifier(TEMPLATE_PARAMS.INSTANCE), node) as Node
                    );
                }
            },
        });

        return expression as t.Expression;
    }

    genStaticElement(element: StaticElement, slotParentName?: string): t.Expression {
        const staticParts = this.genStaticParts(element);
        // Generate static parts prior to serialization to inject the corresponding static part Id into the serialized output.
        const html = serializeStaticElement(element, this);

        const parseMethod =
            element.name !== 'svg' && element.namespace === SVG_NAMESPACE
                ? PARSE_SVG_FRAGMENT_METHOD_NAME
                : PARSE_FRAGMENT_METHOD_NAME;

        this.usedLwcApis.add(parseMethod);

        // building the taggedTemplate expression as if it were a string
        const expr = t.taggedTemplateExpression(
            t.identifier(parseMethod),
            t.templateLiteral(
                [
                    {
                        type: 'TemplateElement',
                        tail: true,
                        value: {
                            raw: html,
                            cooked: html,
                        },
                    },
                ],
                []
            )
        );

        const identifier = t.identifier(`$fragment${this.hoistedNodes.length + 1}`);
        this.hoistedNodes.push({
            identifier,
            expr,
        });

        // Keys are only supported at the top level of a static block, and are serialized directly in the args for
        // the `api_static_fragment` call. We don't need to support keys in static parts (i.e. children of
        // the top-level element), because the compiler ignores any keys that aren't direct children of a
        // for:each block (see error code 1149 - "KEY_SHOULD_BE_IN_ITERATION").
        const key = element.directives.find(isKeyDirective);
        const keyExpression = this.genKeyExpression(key, slotParentName);

        const args: t.Expression[] = [identifier, keyExpression];

        // Only add the third argument (staticParts) if this element needs it
        if (staticParts) {
            args.push(staticParts);
        }

        return this._renderApiCall(RENDER_APIS.staticFragment, args);
    }

    genStaticParts(element: StaticElement): t.ArrayExpression | undefined {
        const stack: (StaticChildNode | Text[])[] = [element];
        const partIdsToArgs = new Map<number, { text: t.Expression; databag: t.Expression }>();
        let partId = -1;

        const getPartIdArgs = (partId: number) => {
            let args = partIdsToArgs.get(partId);
            if (!args) {
                args = { text: t.literal(null), databag: t.literal(null) };
                partIdsToArgs.set(partId, args);
            }
            return args;
        };

        const setPartIdText = (text: t.Expression) => {
            const args = getPartIdArgs(partId)!;
            args.text = text;
        };

        const setPartIdDatabag = (databag: t.Property[]) => {
            const args = getPartIdArgs(partId)!;
            args.databag = t.objectExpression(databag);
        };

        // Depth-first traversal. We assign a partId to each element, which is an integer based on traversal order.
        while (stack.length > 0) {
            const currentNode = stack.shift()!;

            // Skip comment nodes in parts count, as they will be stripped in production, unless when `lwc:preserve-comments` is enabled
            if (isContiguousText(currentNode) || !isComment(currentNode) || this.preserveComments) {
                partId++;
            }

            if (isContiguousText(currentNode)) {
                const textNodes = currentNode;
                if (hasDynamicText(textNodes)) {
                    const partToken = `${STATIC_PART_TOKEN_ID.TEXT}${partId}`;
                    // Use the first text node as the key.
                    // Dynamic text is guaranteed to have at least 1 text node in the array by transformStaticChildren.
                    this.staticExpressionMap.set(textNodes[0], partToken);
                    const concatenatedText = this.genConcatenatedText(
                        textNodes.map(({ value }) =>
                            isStringLiteral(value) ? value.value : this.bindExpression(value)
                        )
                    );
                    setPartIdText(concatenatedText);
                }
            } else if (isElement(currentNode)) {
                const databag = [];
                // has event listeners
                if (currentNode.listeners.length) {
                    databag.push(this.genEventListeners(currentNode.listeners));
                }

                // See STATIC_SAFE_DIRECTIVES for what's allowed here.
                // Also note that we don't generate the 'key' here, because we only support it at the top level
                // directly passed into the `api_static_fragment` function, not as a part.
                for (const directive of currentNode.directives) {
                    if (directive.name === 'Ref') {
                        databag.push(this.genRef(directive));
                    }
                }

                const attributeExpressions = [];

                for (const attribute of currentNode.attributes) {
                    const { name, value } = attribute;

                    // IDs/IDRefs must be handled dynamically at runtime due to synthetic shadow scoping.
                    // Note that for backwards compat we only consider non-booleans to be dynamic IDs/IDRefs
                    const isIdOrIdRef =
                        (name === 'id' || isIdReferencingAttribute(name)) &&
                        !isBooleanLiteral(value);

                    // For boolean literals (e.g. `<use xlink:href>`), there is no reason to sanitize since it's empty
                    const isSvgHref =
                        isSvgUseHref(currentNode.name, name, currentNode.namespace) &&
                        !isBooleanLiteral(value);

                    // `<a href="#foo">` and `<area href="#foo">` must be dynamic due to synthetic shadow scoping
                    // Note this only applies if there is an `id` attribute somewhere in the template
                    const isScopedFragmentRef =
                        this.scopeFragmentId &&
                        isStringLiteral(value) &&
                        isAllowedFragOnlyUrlsXHTML(currentNode.name, name, currentNode.namespace) &&
                        isFragmentOnlyUrl(value.value);

                    // If we're not running in synthetic shadow mode (light or shadow+disableSyntheticShadowSupport),
                    // then static IDs/IDrefs/fragment refs will be rendered directly into HTML strings.
                    const needsScoping =
                        this.isSyntheticShadow && (isIdOrIdRef || isScopedFragmentRef);

                    if (isExpression(value) || isSvgHref || needsScoping) {
                        let partToken = '';
                        if (name === 'style') {
                            partToken = `${STATIC_PART_TOKEN_ID.STYLE}${partId}`;
                            databag.push(
                                t.property(t.identifier('style'), this.bindExpression(value))
                            );
                        } else if (name === 'class') {
                            partToken = `${STATIC_PART_TOKEN_ID.CLASS}${partId}`;

                            databag.push(
                                t.property(
                                    t.identifier('className'),
                                    this.genClassExpression(value as Expression)
                                )
                            );
                        } else {
                            // non-class, non-style (i.e. generic attribute or ID/IDRef or svg use href)

                            partToken = `${STATIC_PART_TOKEN_ID.ATTRIBUTE}${partId}:${name}`;

                            attributeExpressions.push(
                                t.property(
                                    t.literal(name),
                                    bindAttributeExpression(
                                        attribute,
                                        currentNode,
                                        this,
                                        // `addLegacySanitizationHook` is true because `isCustomRendererHookRequired`
                                        // being false is a precondition for static nodes.
                                        true
                                    )
                                )
                            );
                        }
                        this.staticExpressionMap.set(attribute, partToken);
                    }
                }

                if (attributeExpressions.length) {
                    databag.push(
                        t.property(t.identifier('attrs'), t.objectExpression(attributeExpressions))
                    );
                }

                if (databag.length) {
                    setPartIdDatabag(databag);
                }

                // For depth-first traversal, children must be prepended in order, so that they are processed before
                // siblings. Note that this is consistent with the order used in the diffing algo as well as
                // `traverseAndSetElements` in @lwc/engine-core.
                stack.unshift(...transformStaticChildren(currentNode, this.preserveComments));
            }
        }

        if (partIdsToArgs.size === 0) {
            return undefined; // no parts needed
        }

        return t.arrayExpression(
            [...partIdsToArgs.entries()].map(([partId, { databag, text }]) => {
                return this.genStaticPart(partId, databag, text);
            })
        );
    }

    genStaticPart(partId: number, data: t.Expression, text: t.Expression): t.CallExpression {
        return this._renderApiCall(RENDER_APIS.staticPart, [t.literal(partId), data, text]);
    }

    getStaticExpressionToken(node: Attribute | Text): string {
        const token = this.staticExpressionMap.get(node);
        /* istanbul ignore if */
        if (isUndefined(token)) {
            // It should not be possible to hit this code path
            const nodeName = isAttribute(node) ? node.name : 'text node';
            throw new Error(
                `Template compiler internal error, unable to map ${nodeName} to a static expression.`
            );
        }
        return token;
    }
}
