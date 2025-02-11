/*
 * Copyright (c) 2018, salesforce.com, inc.
 * All rights reserved.
 * SPDX-License-Identifier: MIT
 * For full license text, see the LICENSE file in the repo root or https://opensource.org/licenses/MIT
 */

import { renderComponent } from '@lwc/ssr-runtime';

import Table from '@lwc/perf-benchmarks-components/dist/ssr/benchmark/table/table.js';
import Store from '@lwc/perf-benchmarks-components/dist/ssr/benchmark/store/store.js';

benchmark(`ssr/table-v2/render/10k`, () => {
    run(() => {
        const store = new Store();
        store.runLots();

        return renderComponent('benchmark-table', Table, {
            rows: store.data,
        });
    });
});
