import { AsyncLocalStorage } from "node:async_hooks";

interface RuntimeLogContextInput {
	readonly errorSink: (...fields: unknown[]) => void;
	readonly method: string;
	readonly path: string;
}

interface RuntimeLogContext extends RuntimeLogContextInput {
	emitting: boolean;
}

const runtimeLogContext = new AsyncLocalStorage<RuntimeLogContext>();
let installed = false;
let outOfContextErrorSink: ((...fields: unknown[]) => void) | undefined;

function emitOutOfContext(...fields: unknown[]): void {
	outOfContextErrorSink?.(...fields);
}

// Runtime 1.63.1 has no injectable validation logger: its shared logger is
// console. Install one stable wrapper and use async context instead of racing
// request-time console swaps.
function redactedSdkError(...fields: unknown[]): void {
	const context = runtimeLogContext.getStore();
	if (context === undefined) {
		emitOutOfContext(...fields);
		return;
	}
	if (context.emitting) {
		emitOutOfContext(...fields);
		return;
	}

	const redactedFields = [
		"copilotkit_runtime_error",
		{
			method: context.method,
			path: context.path,
			code: "sdk_error_redacted",
		},
	] as const;
	context.emitting = true;
	try {
		context.errorSink(...redactedFields);
	} catch {
		emitOutOfContext(...redactedFields);
	} finally {
		context.emitting = false;
	}
}

export function installRuntimeLogBoundary(): void {
	if (installed) {
		return;
	}
	outOfContextErrorSink = console.error.bind(console);
	console.error = redactedSdkError;
	installed = true;
}

export function runWithRuntimeLogBoundary<T>(
	context: RuntimeLogContextInput,
	callback: () => T,
): T {
	return runtimeLogContext.run({ ...context, emitting: false }, callback);
}
