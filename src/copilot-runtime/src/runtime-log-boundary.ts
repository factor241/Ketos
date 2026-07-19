import { AsyncLocalStorage } from "node:async_hooks";

interface ErrorLogSink {
	readonly error: (...fields: unknown[]) => void;
}

interface RuntimeLogContext {
	readonly logger: ErrorLogSink;
	readonly method: string;
	readonly path: string;
}

const runtimeLogContext = new AsyncLocalStorage<RuntimeLogContext>();
const originalConsoleError = console.error.bind(console);

// Runtime 1.63.1 has no injectable validation logger: its shared logger is
// console. Install one stable wrapper and use async context instead of racing
// request-time console swaps.
function redactedSdkError(...fields: unknown[]): void {
	const context = runtimeLogContext.getStore();
	if (context === undefined) {
		originalConsoleError(...fields);
		return;
	}
	context.logger.error("copilotkit_runtime_error", {
		method: context.method,
		path: context.path,
		code: "sdk_error_redacted",
	});
}

export function installRuntimeLogBoundary(): void {
	if (console.error !== redactedSdkError) {
		console.error = redactedSdkError;
	}
}

export function logOutsideRuntimeBoundary(...fields: unknown[]): void {
	originalConsoleError(...fields);
}

export function runWithRuntimeLogBoundary<T>(
	context: RuntimeLogContext,
	callback: () => T,
): T {
	return runtimeLogContext.run(context, callback);
}
