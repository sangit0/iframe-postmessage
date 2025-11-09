import { BridgeModel, ChildAPIImplementation } from './child';
import { BridgeParent, ParentAPIImplementation } from './parent';
import type {
    ChildAPI,
    IframePostmessageConfig,
    ParentAPI,
} from './types';

const IframePostmessageImplementation = function IframePostmessage(config: IframePostmessageConfig) {
    return new BridgeParent(config);
} as unknown as {
    (config: IframePostmessageConfig): Promise<ParentAPIImplementation>;
    Parent: typeof BridgeParent;
    Model: typeof BridgeModel;
    debug: boolean;
    Promise: PromiseConstructor | null;
};

const IframePostmessage = IframePostmessageImplementation;

IframePostmessage.Parent = BridgeParent;
IframePostmessage.Model = BridgeModel;
IframePostmessage.debug = false;
IframePostmessage.Promise = (() => {
    try {
        return window ? window.Promise : Promise;
    } catch {
        return null;
    }
})();

export default IframePostmessage;
export {
    BridgeModel,
    BridgeParent,
    ChildAPIImplementation,
    IframePostmessage,
    ParentAPIImplementation,
};
export type {
    ChildAPI,
    IframePostmessageConfig,
    ParentAPI,
};
