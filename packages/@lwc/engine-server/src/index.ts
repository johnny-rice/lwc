/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */
// Globals -----------------------------------------------------------------------------------------
import '@lwc/features';

// Polyfills ---------------------------------------------------------------------------------------
import './polyfills';

// Engine-core public APIs -------------------------------------------------------------------------
export {
    api,
    track,
    wire,
    readonly,
    unwrap,
    setFeatureFlag,
    setFeatureFlagForTest,
    registerTemplate,
    freezeTemplate,
    registerComponent,
    registerDecorators,
    sanitizeAttribute,
    setHooks,
    getComponentDef,
    isComponentConstructor,
    isTrustedSignal,
    parseFragment,
    parseFragment as parseSVGFragment,
    setTrustedContextSet,
    addTrustedContext as __dangerous_do_not_use_addTrustedContext,
    setContextKeys,
    SignalBaseClass,
} from '@lwc/engine-core';

// Engine-server public APIs -----------------------------------------------------------------------
export { renderComponent } from './apis/render-component';
export { LightningElement } from './apis/lightning-element';
export { renderer } from './renderer';
export { createElement } from './apis/create-element';
export { createContextProvider } from './context';
export { hot, swapComponent, swapStyle, swapTemplate } from './apis/hot-swaps';
