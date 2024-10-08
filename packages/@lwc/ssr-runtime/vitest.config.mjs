import { defineProject, mergeConfig } from 'vitest/config';
import baseConfig from '../../../vitest.shared.mjs';

export default mergeConfig(
    baseConfig,
    defineProject({
        test: {
            name: 'lwc-ssr-runtime',
        },
    })
);
