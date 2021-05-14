import { createElement, setFeatureFlagForTest } from 'lwc';
import Basic from 'x/basic';
import Other from 'x/other';
import Switchable from 'x/switchable';

describe('Light DOM scoped CSS', () => {
    beforeEach(() => {
        setFeatureFlagForTest('ENABLE_LIGHT_DOM_COMPONENTS', true);
    });
    afterEach(() => {
        setFeatureFlagForTest('ENABLE_LIGHT_DOM_COMPONENTS', false);
    });
    it('should scope scoped CSS and allow unscoped CSS to leak out', () => {
        const basicElement = createElement('x-basic', { is: Basic });
        const otherElement = createElement('x-other', { is: Other });
        document.body.appendChild(basicElement);
        document.body.appendChild(otherElement);

        const basicComputed = getComputedStyle(basicElement.querySelector('div'));
        const otherComputed = getComputedStyle(otherElement.querySelector('div'));
        expect(basicComputed.color).toEqual('rgb(0, 128, 0)');
        expect(basicComputed.marginLeft).toEqual('10px');
        expect(basicComputed.marginRight).toEqual('5px');
        expect(otherComputed.color).toEqual('rgb(0, 0, 0)');
        expect(otherComputed.marginLeft).toEqual('10px');
        expect(otherComputed.marginRight).toEqual('5px');
    });

    it('should replace scoped styles correctly with dynamic templates', () => {
        const elm = createElement('x-switchable', { is: Switchable });

        document.body.appendChild(elm);

        const rafPromise = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));

        // A (no styles) -> B (styles) -> C (no styles) -> D (styles)
        expect(getComputedStyle(elm).marginLeft).toEqual('0px');
        expect(getComputedStyle(elm.querySelector('div')).color).toEqual('rgb(0, 0, 0)');
        elm.next();
        return rafPromise()
            .then(() => {
                expect(getComputedStyle(elm).marginLeft).toEqual('20px');
                expect(getComputedStyle(elm.querySelector('div')).color).toEqual('rgb(255, 0, 0)');
                elm.next();
                return rafPromise();
            })
            .then(() => {
                expect(getComputedStyle(elm).marginLeft).toEqual('0px');
                expect(getComputedStyle(elm.querySelector('div')).color).toEqual('rgb(0, 0, 0)');
                elm.next();
                return rafPromise();
            })
            .then(() => {
                expect(getComputedStyle(elm).marginLeft).toEqual('30px');
                expect(getComputedStyle(elm.querySelector('div')).color).toEqual('rgb(0, 0, 255)');
            });
    });
});