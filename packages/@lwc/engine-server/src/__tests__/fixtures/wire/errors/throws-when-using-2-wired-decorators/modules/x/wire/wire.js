import { wire, LightningElement } from 'lwc';
import { Adapter } from 'x/adapter';
export default class Test extends LightningElement {
    @wire(Adapter, { key1: '$prop1', key2: ['fixed', 'array'] })
    @wire(Adapter, { key1: '$prop1', key2: ['fixed', 'array'] })
    multipleWire;
}
