import sharedSleep from "../../shared/sleep";

export const sleep = (ms: number): Promise<void> => {
	return sharedSleep(ms);
};

export default sleep;