/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */

import { defineProperty, isFrozen, isUndefined } from '@lwc/shared';

import { getErrorComponentStack } from './format';
import type { VM } from '../framework/vm';

export function addErrorComponentStack(vm: VM, error: any): void {
    if (!isFrozen(error) && isUndefined(error.wcStack)) {
        const wcStack = getErrorComponentStack(vm);
        defineProperty(error, 'wcStack', {
            get() {
                return wcStack;
            },
        });
    }
}
