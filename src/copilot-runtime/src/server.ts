import { createServer, type Server } from "node:http";
import { pathToFileURL } from "node:url";

import { HttpAgent, type HttpAgentFetchFn } from "@ag-ui/client";
import {
	CopilotRuntime,
	createCopilotRuntimeHandler,
} from "@copilotkit/runtime/v2";
import { createCopilotNodeHandler } from "@copilotkit/runtime/v2/node";

import {
	sanitizeIncomingCredentials,
	selectUpstreamCredentialHeaders,
} from "./credential-forwarding.js";
import {
	DEFAULT_ALLOWED_HOSTS,
	validateRuntimeRequest,
} from "./origin-guard.js";
import {
	installRuntimeLogBoundary,
	logOutsideRuntimeBoundary,
	runWithRuntimeLogBoundary,
} from "./runtime-log-boundary.js";

export const AGENT_ID = "ketos-mvp-probe";
export const COPILOT_PATH = "/api/copilotkit";
export const UPSTREAM_URL = "http://127.0.0.1:7860/api/v1/agentic/ag-ui";

export interface KetosCopilotServerOptions {
	readonly upstreamUrl?: string;
	readonly allowedHosts?: readonly string[];
	readonly logger?: RuntimeLogger;
}

export interface RuntimeLogger {
	readonly info: (...fields: unknown[]) => void;
	readonly error: (...fields: unknown[]) => void;
}

const DEFAULT_LOGGER: RuntimeLogger = {
	info: (...fields) => console.info(...fields),
	error: logOutsideRuntimeBoundary,
};

const noRedirectFetch: HttpAgentFetchFn = async (url, requestInit) => {
	let response: Response;
	try {
		response = await fetch(url, { ...requestInit, redirect: "error" });
	} catch {
		throw new Error("upstream_transport_error");
	}
	if (response.ok) {
		return response;
	}

	await response.body?.cancel().catch(() => undefined);
	const error =
		response.status === 401 || response.status === 403
			? "upstream_access_denied"
			: "upstream_error";
	return new Response(JSON.stringify({ error }), {
		status: response.status,
		headers: { "content-type": "application/json" },
	});
};

function safeRuntimePath(target: string | undefined): string {
	if (target === undefined || !target.startsWith("/")) {
		return "<invalid>";
	}
	const path = target.split("?", 1)[0] ?? "";
	if (
		path === `${COPILOT_PATH}/info` ||
		new RegExp(
			`^${COPILOT_PATH}/agent/${AGENT_ID}/(?:run|connect|stop|suggest)$`,
			"u",
		).test(path)
	) {
		return path;
	}
	return "<unrecognized>";
}

export function createKetosCopilotServer(
	options: KetosCopilotServerOptions = {},
): Server {
	process.env.COPILOTKIT_TELEMETRY_DISABLED = "true";
	installRuntimeLogBoundary();
	const upstreamUrl = options.upstreamUrl ?? UPSTREAM_URL;
	const allowedHosts = options.allowedHosts ?? DEFAULT_ALLOWED_HOSTS;
	const logger = options.logger ?? DEFAULT_LOGGER;
	const runtime = new CopilotRuntime({
		agents: ({ request }) => ({
			[AGENT_ID]: new HttpAgent({
				url: upstreamUrl,
				headers: selectUpstreamCredentialHeaders(request.headers),
				fetch: noRedirectFetch,
			}),
		}),
		forwardHeaders: { allow: ["authorization"] },
	});
	const runtimeHandler = createCopilotRuntimeHandler({
		runtime,
		basePath: COPILOT_PATH,
		activateChannels: false,
	});
	const nodeHandler = createCopilotNodeHandler(runtimeHandler);

	return createServer((request, response) => {
		const method = request.method ?? "UNKNOWN";
		const path = safeRuntimePath(request.url);
		const guard = validateRuntimeRequest(request, allowedHosts);
		if (!guard.allowed) {
			response.writeHead(403, { "content-type": "application/json" });
			response.end(
				JSON.stringify({ error: "request_denied", code: guard.code }),
			);
			logger.info("runtime_request", {
				method,
				path,
				status: 403,
				code: guard.code,
			});
			return;
		}
		sanitizeIncomingCredentials(request);
		response.once("finish", () => {
			logger.info("runtime_request", {
				method,
				path,
				status: response.statusCode,
			});
		});
		void runWithRuntimeLogBoundary({ logger, method, path }, () =>
			nodeHandler(request, response),
		).catch(() => {
			logger.error("runtime_request_failed", {
				method,
				path,
				status: 502,
				code: "runtime_handler_error",
			});
			if (!response.headersSent) {
				response.writeHead(502, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						error: "runtime_handler_error",
						code: "runtime_handler_error",
					}),
				);
			}
		});
	});
}

export async function startServer(): Promise<Server> {
	const server = createKetosCopilotServer();
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(8788, "127.0.0.1", resolve);
	});
	return server;
}

const executablePath = process.argv[1];
if (
	executablePath !== undefined &&
	import.meta.url === pathToFileURL(executablePath).href
) {
	void startServer().catch(() => {
		console.error("runtime_start_failed", {
			host: "127.0.0.1",
			port: 8788,
			code: "listen_failed",
		});
		process.exitCode = 1;
	});
}
