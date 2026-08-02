import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	request as nodeRequest,
	type Server,
} from "node:http";
import { type AddressInfo, connect } from "node:net";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inspect, promisify } from "node:util";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { AGENT_ID, createKetosCopilotServer } from "../server.js";

const servers = new Set<Server>();
const execFileAsync = promisify(execFile);
const initialConsoleError = console.error;
const initialConsoleInfo = console.info;
const instrumentedConsoleErrors: unknown[][] = [];
const instrumentedConsoleInfos: unknown[][] = [];
console.error = (...fields: unknown[]) =>
	instrumentedConsoleErrors.push(fields);
console.info = (...fields: unknown[]) => instrumentedConsoleInfos.push(fields);

afterAll(() => {
	console.error = initialConsoleError;
	console.info = initialConsoleInfo;
});

afterEach(async () => {
	await Promise.all(
		[...servers].map(
			(server) =>
				new Promise<void>((resolve, reject) => {
					server.closeAllConnections();
					server.close((error) => (error ? reject(error) : resolve()));
				}),
		),
	);
	servers.clear();
});

async function listen(server: Server): Promise<string> {
	servers.add(server);
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const address = server.address() as AddressInfo;
	return `http://127.0.0.1:${address.port}`;
}

function runInput(overrides: Record<string, unknown> = {}) {
	return {
		threadId: "thread-fixed-target",
		runId: "run-fixed-target",
		state: {},
		messages: [],
		tools: [],
		context: [],
		forwardedProps: {},
		...overrides,
	};
}

function createTestRuntime(upstreamUrl: string): Server {
	return createKetosCopilotServer({
		upstreamUrl,
		allowedHosts: ["127.0.0.1"],
		logger: { info: () => undefined, error: () => undefined },
	});
}

async function rawRuntimeRequest(
	runtimeOrigin: string,
	options: {
		readonly path?: string;
		readonly headers?: Readonly<Record<string, string>>;
	} = {},
): Promise<{ status: number; body: string }> {
	const target = new URL(runtimeOrigin);
	return await new Promise((resolve, reject) => {
		const request = nodeRequest(
			{
				hostname: target.hostname,
				port: target.port,
				method: "POST",
				path: options.path ?? `/api/copilotkit/agent/${AGENT_ID}/run`,
				headers: {
					"content-type": "application/json",
					...options.headers,
				},
			},
			(response) => {
				const chunks: Buffer[] = [];
				response.on("data", (chunk: Buffer) => chunks.push(chunk));
				response.on("end", () => {
					resolve({
						status: response.statusCode ?? 0,
						body: Buffer.concat(chunks).toString("utf8"),
					});
				});
			},
		);
		request.once("error", reject);
		request.end(JSON.stringify(runInput()));
	});
}

async function rawSocketRuntimeRequest(
	runtimeOrigin: string,
	headerLines: readonly string[],
): Promise<{ status: number; body: string }> {
	const target = new URL(runtimeOrigin);
	const requestBody = JSON.stringify(runInput());
	const response = await new Promise<string>((resolve, reject) => {
		const socket = connect({
			host: target.hostname,
			port: Number.parseInt(target.port, 10),
		});
		const chunks: Buffer[] = [];
		socket.once("error", reject);
		socket.on("data", (chunk: Buffer) => {
			chunks.push(chunk);
			const received = Buffer.concat(chunks).toString("utf8");
			const headerEnd = received.indexOf("\r\n\r\n");
			if (
				headerEnd !== -1 &&
				received.slice(headerEnd + 4).endsWith("\r\n0\r\n\r\n")
			) {
				resolve(received);
				socket.destroy();
			}
		});
		socket.once("connect", () => {
			socket.write(
				[
					`POST /api/copilotkit/agent/${AGENT_ID}/run HTTP/1.1`,
					`Host: ${target.host}`,
					"Content-Type: application/json",
					`Content-Length: ${Buffer.byteLength(requestBody)}`,
					"Connection: close",
					...headerLines,
					"",
					requestBody,
				].join("\r\n"),
			);
		});
	});
	const [head = "", responseBody = ""] = response.split("\r\n\r\n", 2);
	const status = Number.parseInt(head.split(" ")[1] ?? "0", 10);
	return { status, body: responseBody };
}

describe("Ketos Copilot Runtime transport", () => {
	it("registers exactly one fixed agent and ignores browser target overrides", async () => {
		const capturedUrls: string[] = [];
		const upstream = createServer((request, response) => {
			capturedUrls.push(request.url ?? "");
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				[
					`data: ${JSON.stringify({ type: "RUN_STARTED", threadId: "thread-fixed-target", runId: "run-fixed-target" })}`,
					"",
					`data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: "thread-fixed-target", runId: "run-fixed-target" })}`,
					"",
				].join("\n"),
			);
		});
		const upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
		);

		const infoResponse = await fetch(`${runtimeOrigin}/api/copilotkit/info`);
		expect(infoResponse.status).toBe(200);
		const info = (await infoResponse.json()) as {
			agents: Record<string, unknown>;
		};
		expect(Object.keys(info.agents)).toEqual([AGENT_ID]);

		const response = await fetch(
			`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run?target=http://127.0.0.1:1&agentUrl=http://127.0.0.1:2`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(
					runInput({
						url: "http://127.0.0.1:3",
						target: "http://127.0.0.1:4",
						agentUrl: "http://127.0.0.1:5",
						model: "browser-model",
						actor_id: "browser-actor",
					}),
				),
			},
		);
		expect(response.status).toBe(200);
		await response.text();
		expect(capturedUrls).toEqual(["/api/v1/agentic/ag-ui"]);

		const unknownResponse = await fetch(
			`${runtimeOrigin}/api/copilotkit/agent/not-${AGENT_ID}/run`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(runInput()),
			},
		);
		expect(unknownResponse.status).toBe(404);
		expect(capturedUrls).toHaveLength(1);
	});

	it("forwards only a valid Bearer credential and preserves standard run input", async () => {
		let capturedHeaders: IncomingMessage["headers"] = {};
		let capturedBody: unknown;
		const upstream = createServer((request, response) => {
			capturedHeaders = request.headers;
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				capturedBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
				response.writeHead(200, { "content-type": "text/event-stream" });
				response.end(
					[
						`data: ${JSON.stringify({ type: "RUN_STARTED", threadId: "thread-bearer", runId: "run-bearer" })}`,
						"",
						`data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: "thread-bearer", runId: "run-bearer" })}`,
						"",
					].join("\n"),
				);
			});
		});
		const upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
		);
		const input = runInput({
			threadId: "thread-bearer",
			runId: "run-bearer",
			tools: [
				{
					name: "read_only_probe",
					description: "Read-only test tool",
					parameters: { type: "object", properties: {} },
				},
			],
			context: [{ description: "probe", value: "bounded" }],
			forwardedProps: { marker: "unchanged" },
			resume: [
				{
					interruptId: "interrupt-1",
					status: "resolved",
					payload: { approved: true },
				},
			],
		});

		const response = await fetch(
			`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run?api_key=query-secret`,
			{
				method: "POST",
				headers: {
					authorization: "Bearer bearer-secret",
					cookie:
						"access_token_lf=cookie-secret; refresh_token_lf=refresh-secret; apikey_tkn_lflw=api-cookie-secret; other=other-secret",
					"content-type": "application/json",
					"x-api-key": "header-api-secret",
					"x-custom-secret": "custom-secret",
				},
				body: JSON.stringify(input),
			},
		);
		await response.text();

		expect(capturedHeaders.authorization).toBe("Bearer bearer-secret");
		expect(capturedHeaders.cookie).toBeUndefined();
		expect(capturedHeaders["x-api-key"]).toBeUndefined();
		expect(capturedHeaders["x-custom-secret"]).toBeUndefined();
		expect(capturedBody).toEqual(input);
	});

	it("forwards one sanitized access cookie and fails closed on duplicates", async () => {
		const capturedCookies: Array<string | undefined> = [];
		const upstream = createServer((request, response) => {
			capturedCookies.push(request.headers.cookie);
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				[
					`data: ${JSON.stringify({ type: "RUN_STARTED", threadId: "thread-cookie", runId: "run-cookie" })}`,
					"",
					`data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: "thread-cookie", runId: "run-cookie" })}`,
					"",
				].join("\n"),
			);
		});
		const upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
		);
		const send = async (cookie: string) => {
			const response = await fetch(
				`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run`,
				{
					method: "POST",
					headers: { cookie, "content-type": "application/json" },
					body: JSON.stringify(
						runInput({ threadId: "thread-cookie", runId: "run-cookie" }),
					),
				},
			);
			await response.text();
		};

		await send(
			"other=discard; access_token_lf=access.jwt-token_123; refresh_token_lf=discard; apikey_tkn_lflw=discard",
		);
		await send("access_token_lf=first; access_token_lf=second");

		expect(capturedCookies).toEqual([
			"access_token_lf=access.jwt-token_123",
			undefined,
		]);
	});

	it("does not fall back to a cookie when an Authorization scheme is invalid", async () => {
		let capturedAuthorization: string | undefined;
		let capturedCookie: string | undefined;
		const upstream = createServer((request, response) => {
			capturedAuthorization = request.headers.authorization;
			capturedCookie = request.headers.cookie;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				[
					`data: ${JSON.stringify({ type: "RUN_STARTED", threadId: "thread-invalid-auth", runId: "run-invalid-auth" })}`,
					"",
					`data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: "thread-invalid-auth", runId: "run-invalid-auth" })}`,
					"",
				].join("\n"),
			);
		});
		const upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
		);

		const response = await fetch(
			`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run`,
			{
				method: "POST",
				headers: {
					authorization: "Basic not-a-bearer",
					cookie: "access_token_lf=must-not-fallback",
					"content-type": "application/json",
				},
				body: JSON.stringify(
					runInput({
						threadId: "thread-invalid-auth",
						runId: "run-invalid-auth",
					}),
				),
			},
		);
		await response.text();

		expect(capturedAuthorization).toBeUndefined();
		expect(capturedCookie).toBeUndefined();
	});

	it("fails closed when a raw request contains duplicate Authorization fields", async () => {
		let capturedAuthorization: string | undefined;
		let capturedCookie: string | undefined;
		let upstreamCalls = 0;
		let resolveUpstream: (() => void) | undefined;
		const upstreamObserved = new Promise<void>((resolve) => {
			resolveUpstream = resolve;
		});
		const upstream = createServer((request, response) => {
			upstreamCalls += 1;
			capturedAuthorization = request.headers.authorization;
			capturedCookie = request.headers.cookie;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				[
					`data: ${JSON.stringify({ type: "RUN_STARTED", threadId: "thread-fixed-target", runId: "run-fixed-target" })}`,
					"",
					`data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: "thread-fixed-target", runId: "run-fixed-target" })}`,
					"",
				].join("\n"),
			);
			resolveUpstream?.();
		});
		const upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
		);

		const [response] = await Promise.all([
			rawSocketRuntimeRequest(runtimeOrigin, [
				"Authorization: Bearer duplicate-first-secret",
				"Authorization: Bearer duplicate-second-secret",
				"Cookie: access_token_lf=must-not-fallback",
			]),
			upstreamObserved,
		]);

		expect(response.status).toBe(200);
		expect(upstreamCalls).toBe(1);
		expect(capturedAuthorization).toBeUndefined();
		expect(capturedCookie).toBeUndefined();
	});

	it("denies hostile Origin, Host, forwarded host, and absolute-form targets before upstream", async () => {
		let upstreamCalls = 0;
		const upstream = createServer((_request, response) => {
			upstreamCalls += 1;
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(
				[
					`data: ${JSON.stringify({ type: "RUN_STARTED", threadId: "thread-fixed-target", runId: "run-fixed-target" })}`,
					"",
					`data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: "thread-fixed-target", runId: "run-fixed-target" })}`,
					"",
				].join("\n"),
			);
		});
		const upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
		);
		const runtimeHost = new URL(runtimeOrigin).host;

		const valid = await rawRuntimeRequest(runtimeOrigin, {
			headers: { origin: runtimeOrigin },
		});
		expect(valid.status).toBe(200);
		expect(upstreamCalls).toBe(1);

		const denied = await Promise.all([
			rawRuntimeRequest(runtimeOrigin, {
				headers: { origin: "http://evil.test" },
			}),
			rawRuntimeRequest(runtimeOrigin, {
				headers: { host: "evil.test", origin: "http://evil.test" },
			}),
			rawRuntimeRequest(runtimeOrigin, {
				headers: {
					host: runtimeHost,
					origin: runtimeOrigin,
					"x-forwarded-host": "evil.test",
				},
			}),
			rawRuntimeRequest(runtimeOrigin, {
				headers: {
					host: runtimeHost,
					origin: runtimeOrigin,
					forwarded: "for=127.0.0.1;host=evil.test;proto=http",
				},
			}),
			rawRuntimeRequest(runtimeOrigin, {
				headers: { origin: "not an origin" },
			}),
			rawRuntimeRequest(runtimeOrigin, {
				path: `http://evil.test/api/copilotkit/agent/${AGENT_ID}/run`,
				headers: { host: runtimeHost, origin: runtimeOrigin },
			}),
		]);
		expect(denied.map((result) => result.status)).toEqual([
			403, 403, 403, 403, 403, 403,
		]);
		expect(upstreamCalls).toBe(1);
	});

	it("does not follow upstream redirects with credentials", async () => {
		let upstreamOrigin = "";
		let redirectTargetCalls = 0;
		const upstream = createServer((request, response) => {
			if (request.url === "/redirected") {
				redirectTargetCalls += 1;
				response.writeHead(200, { "content-type": "text/event-stream" });
				response.end(
					[
						`data: ${JSON.stringify({ type: "RUN_STARTED", threadId: "thread-redirect", runId: "run-redirect" })}`,
						"",
						`data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: "thread-redirect", runId: "run-redirect" })}`,
						"",
					].join("\n"),
				);
				return;
			}
			response.writeHead(307, { location: `${upstreamOrigin}/redirected` });
			response.end();
		});
		upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
		);

		const response = await fetch(
			`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run`,
			{
				method: "POST",
				headers: {
					authorization: "Bearer redirect-secret",
					"content-type": "application/json",
				},
				body: JSON.stringify(
					runInput({ threadId: "thread-redirect", runId: "run-redirect" }),
				),
			},
		);
		const body = await response.text();

		expect(redirectTargetCalls).toBe(0);
		expect(body).not.toContain("redirect-secret");
		expect(body).not.toContain("RUN_FINISHED");
	});

	it.each([401, 403])(
		"propagates upstream %i denial without reporting success",
		async (denialStatus) => {
			const upstream = createServer((_request, response) => {
				response.writeHead(denialStatus, {
					"content-type": "application/json",
				});
				response.end(JSON.stringify({ detail: "access denied" }));
			});
			const upstreamOrigin = await listen(upstream);
			const runtimeOrigin = await listen(
				createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
			);

			const response = await fetch(
				`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run`,
				{
					method: "POST",
					headers: {
						authorization: `Bearer expired-${denialStatus}`,
						"content-type": "application/json",
					},
					body: JSON.stringify(
						runInput({
							threadId: `thread-deny-${denialStatus}`,
							runId: `run-deny-${denialStatus}`,
						}),
					),
				},
			);
			const body = await response.text();

			expect(response.status).not.toBe(500);
			expect(body.toLowerCase()).toContain("error");
			expect(body).not.toContain("RUN_FINISHED");
			expect(body).not.toContain(`expired-${denialStatus}`);
		},
	);

	it("redacts credentials and query secrets from access and upstream error logs", async () => {
		const accessLogs: unknown[][] = [];
		instrumentedConsoleErrors.length = 0;
		const upstream = createServer((_request, response) => {
			response.writeHead(401, { "content-type": "application/json" });
			response.end(
				JSON.stringify({
					detail:
						"bearer-log-secret cookie-log-secret refresh-log-secret query-log-secret",
				}),
			);
		});
		const upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createKetosCopilotServer({
				upstreamUrl: `${upstreamOrigin}/api/v1/agentic/ag-ui`,
				allowedHosts: ["127.0.0.1"],
				logger: {
					info: (...fields: unknown[]) => accessLogs.push(fields),
					error: (...fields: unknown[]) => accessLogs.push(fields),
				},
			}),
		);

		const response = await fetch(
			`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run?api_key=query-log-secret`,
			{
				method: "POST",
				headers: {
					authorization: "Bearer bearer-log-secret",
					cookie:
						"access_token_lf=cookie-log-secret; refresh_token_lf=refresh-log-secret",
					"content-type": "application/json",
				},
				body: JSON.stringify(
					runInput({ threadId: "thread-log", runId: "run-log" }),
				),
			},
		);
		await response.text();
		await rawRuntimeRequest(runtimeOrigin, {
			path: `/api/copilotkit/agent/${AGENT_ID}/run?api_key=query-log-secret`,
			headers: {
				host: "evil.test",
				authorization: "Bearer bearer-log-secret",
				cookie: "access_token_lf=cookie-log-secret",
			},
		});

		const renderedLogs = [
			...accessLogs.map((entry) => inspect(entry)),
			...instrumentedConsoleErrors.map((entry) => inspect(entry)),
		].join("\n");
		for (const secret of [
			"bearer-log-secret",
			"cookie-log-secret",
			"refresh-log-secret",
			"query-log-secret",
		]) {
			expect(renderedLogs).not.toContain(secret);
		}
		expect(accessLogs).toContainEqual([
			"runtime_request",
			{
				method: "POST",
				path: `/api/copilotkit/agent/${AGENT_ID}/run`,
				status: 403,
				code: "host_not_allowed",
			},
		]);
	});

	it("returns 400 without logging secrets from malformed standard run input", async () => {
		const runtimeLogs: unknown[][] = [];
		const secret = "malformed-resume-status-secret";
		const runtimeOrigin = await listen(
			createKetosCopilotServer({
				upstreamUrl: "http://127.0.0.1:1/api/v1/agentic/ag-ui",
				allowedHosts: ["127.0.0.1"],
				logger: {
					info: (...fields: unknown[]) => runtimeLogs.push(fields),
					error: (...fields: unknown[]) => runtimeLogs.push(fields),
				},
			}),
		);

		const response = await fetch(
			`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run`,
			{
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(
					runInput({
						resume: [
							{
								interruptId: "interrupt-malformed",
								status: secret,
								payload: { secret },
							},
						],
					}),
				),
			},
		);
		await response.text();
		const renderedLogs = runtimeLogs.map((entry) => inspect(entry)).join("\n");

		expect(response.status).toBe(400);
		expect(renderedLogs).not.toContain(secret);
	});

	it("preserves instrumentation installed before server creation for out-of-context logs", async () => {
		const buildRoot = await mkdtemp(join(process.cwd(), ".runtime-log-child-"));
		try {
			await execFileAsync(process.execPath, [
				resolve("node_modules/typescript/bin/tsc"),
				"-p",
				"tsconfig.build.json",
				"--outDir",
				buildRoot,
			]);
			const moduleUrl = pathToFileURL(join(buildRoot, "server.js")).href;
			const childScript = `
				const runtime = await import(${JSON.stringify(moduleUrl)});
				const instrumented = [];
				console.error = (...fields) => instrumented.push(fields);
				runtime.createKetosCopilotServer({
					logger: { info() {}, error() {} },
				});
				console.error("out-of-context-instrumentation-marker");
				process.stdout.write(JSON.stringify(instrumented));
			`;
			const child = await execFileAsync(
				process.execPath,
				["--input-type=module", "--eval", childScript],
				{ cwd: process.cwd() },
			);

			expect(child.stderr).toBe("");
			expect(JSON.parse(child.stdout)).toEqual([
				["out-of-context-instrumentation-marker"],
			]);
		} finally {
			await rm(buildRoot, { recursive: true, force: true });
		}
	});

	it("keeps malformed concurrent requests at 400 for console and delegating loggers", async () => {
		instrumentedConsoleErrors.length = 0;
		const delegatedLogs: unknown[][] = [];
		const consoleRuntime = await listen(
			createKetosCopilotServer({
				upstreamUrl: "http://127.0.0.1:1/api/v1/agentic/ag-ui",
				allowedHosts: ["127.0.0.1"],
				logger: console,
			}),
		);
		const delegatingRuntime = await listen(
			createKetosCopilotServer({
				upstreamUrl: "http://127.0.0.1:1/api/v1/agentic/ag-ui",
				allowedHosts: ["127.0.0.1"],
				logger: {
					info: () => undefined,
					error: (...fields: unknown[]) => {
						delegatedLogs.push(fields);
						console.error(...fields);
					},
				},
			}),
		);
		const sendMalformed = async (origin: string, secret: string) => {
			const response = await fetch(
				`${origin}/api/copilotkit/agent/${AGENT_ID}/run`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(
						runInput({
							resume: [
								{
									interruptId: "interrupt-recursive-logger",
									status: secret,
								},
							],
						}),
					),
				},
			);
			await response.text();
			return response.status;
		};

		const statuses = await Promise.all([
			sendMalformed(consoleRuntime, "console-logger-secret"),
			sendMalformed(delegatingRuntime, "delegating-logger-secret"),
		]);

		expect(statuses).toEqual([400, 400]);
		const rendered = inspect(delegatedLogs);
		expect(rendered).toContain("sdk_error_redacted");
		expect(rendered).not.toContain("console-logger-secret");
		expect(rendered).not.toContain("delegating-logger-secret");
		const consoleLogs = inspect(instrumentedConsoleErrors);
		expect(consoleLogs).toContain("sdk_error_redacted");
		expect(consoleLogs).not.toContain("console-logger-secret");
		expect(consoleLogs).not.toContain("delegating-logger-secret");
	});

	it("isolates sanitized SDK error logs across concurrent requests", async () => {
		const logsA: unknown[][] = [];
		const logsB: unknown[][] = [];
		const createRuntime = async (logs: unknown[][]) =>
			await listen(
				createKetosCopilotServer({
					upstreamUrl: "http://127.0.0.1:1/api/v1/agentic/ag-ui",
					allowedHosts: ["127.0.0.1"],
					logger: {
						info: (...fields: unknown[]) => logs.push(fields),
						error: (...fields: unknown[]) => logs.push(fields),
					},
				}),
			);
		const [runtimeA, runtimeB] = await Promise.all([
			createRuntime(logsA),
			createRuntime(logsB),
		]);
		const sendMalformed = async (origin: string, secret: string) => {
			const response = await fetch(
				`${origin}/api/copilotkit/agent/${AGENT_ID}/run`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(
						runInput({
							resume: [
								{
									interruptId: "interrupt-malformed",
									status: secret,
								},
							],
						}),
					),
				},
			);
			await response.text();
			return response.status;
		};

		const statuses = await Promise.all([
			sendMalformed(runtimeA, "concurrent-malformed-secret-a"),
			sendMalformed(runtimeB, "concurrent-malformed-secret-b"),
		]);

		expect(statuses).toEqual([400, 400]);
		expect(logsA).toContainEqual([
			"copilotkit_runtime_error",
			{
				method: "POST",
				path: `/api/copilotkit/agent/${AGENT_ID}/run`,
				code: "sdk_error_redacted",
			},
		]);
		expect(logsB).toContainEqual([
			"copilotkit_runtime_error",
			{
				method: "POST",
				path: `/api/copilotkit/agent/${AGENT_ID}/run`,
				code: "sdk_error_redacted",
			},
		]);
		const allLogs = inspect([logsA, logsB]);
		expect(allLogs).not.toContain("concurrent-malformed-secret-a");
		expect(allLogs).not.toContain("concurrent-malformed-secret-b");
	});

	it("keeps simultaneous request credentials isolated", async () => {
		const credentialsByThread = new Map<string, string | undefined>();
		const upstream = createServer((request, response) => {
			const chunks: Buffer[] = [];
			request.on("data", (chunk: Buffer) => chunks.push(chunk));
			request.on("end", () => {
				const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
					threadId: string;
					runId: string;
				};
				credentialsByThread.set(
					body.threadId,
					request.headers.authorization ?? request.headers.cookie,
				);
				const delay = body.threadId === "thread-concurrent-a" ? 20 : 1;
				setTimeout(() => {
					response.writeHead(200, { "content-type": "text/event-stream" });
					response.end(
						[
							`data: ${JSON.stringify({ type: "RUN_STARTED", threadId: body.threadId, runId: body.runId })}`,
							"",
							`data: ${JSON.stringify({ type: "RUN_FINISHED", threadId: body.threadId, runId: body.runId })}`,
							"",
						].join("\n"),
					);
				}, delay);
			});
		});
		const upstreamOrigin = await listen(upstream);
		const runtimeOrigin = await listen(
			createTestRuntime(`${upstreamOrigin}/api/v1/agentic/ag-ui`),
		);
		const run = async (
			threadId: string,
			credentialHeaders: Record<string, string>,
		) => {
			const response = await fetch(
				`${runtimeOrigin}/api/copilotkit/agent/${AGENT_ID}/run`,
				{
					method: "POST",
					headers: { ...credentialHeaders, "content-type": "application/json" },
					body: JSON.stringify(
						runInput({ threadId, runId: `run-${threadId}` }),
					),
				},
			);
			await response.text();
		};

		await Promise.all([
			run("thread-concurrent-a", { authorization: "Bearer concurrent-a" }),
			run("thread-concurrent-b", {
				cookie: "access_token_lf=concurrent-b",
			}),
		]);

		expect(Object.fromEntries(credentialsByThread)).toEqual({
			"thread-concurrent-a": "Bearer concurrent-a",
			"thread-concurrent-b": "access_token_lf=concurrent-b",
		});
	});

	it("keeps production source transport-only", async () => {
		const source = (
			await Promise.all(
				[
					"../server.ts",
					"../credential-forwarding.ts",
					"../origin-guard.ts",
					"../runtime-log-boundary.ts",
				].map(
					async (path) =>
						await readFile(new URL(path, import.meta.url), "utf8"),
				),
			)
		).join("\n");

		expect(source).toContain('from "@copilotkit/runtime/v2"');
		expect(source).toContain('from "@copilotkit/runtime/v2/node"');
		expect(source).toContain('from "@ag-ui/client"');
		expect(source).not.toMatch(
			/RunAgentInput|forwardedProps\.command|Command\s*\(\s*resume|parseSSE|EventEncoder|CustomEvent|modelRouter|MCP/u,
		);
	});
});
