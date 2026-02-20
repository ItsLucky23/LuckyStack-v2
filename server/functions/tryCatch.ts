import sharedTryCatch from "../../shared/tryCatch";

export const tryCatch = async <T, P>(
	func: (values: P) => Promise<T> | T,
	params?: P,
	context?: Record<string, unknown>
): Promise<[Error | null, T | null]> => {
	return sharedTryCatch(func, params, context);
};

export default tryCatch;