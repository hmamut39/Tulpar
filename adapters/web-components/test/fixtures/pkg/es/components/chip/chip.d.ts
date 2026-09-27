import { CHIP_SIZE, CHIP_TONE } from './defs';
declare class Helper {
    unrelated: string;
}
declare class XChip extends HTMLElement {
    tone: CHIP_TONE;
    size?: CHIP_SIZE | string;
    dismissible: boolean;
    extra: any;
    get form(): HTMLFormElement | null;
    static styles: any;
}
export { Helper };
export default XChip;
