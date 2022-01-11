import { LightningElement, api } from 'lwc';

export default class Main extends LightningElement {
    static renderMode = 'light';

    _executedHandlerCounter = 0;

    @api slotText;
    @api
    get timesHandlerIsExecuted() {
        return this._executedHandlerCounter;
    }

    handleClick() {
        this._executedHandlerCounter++;
    }
}
