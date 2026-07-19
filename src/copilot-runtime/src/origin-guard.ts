import type { IncomingMessage } from "node:http";

export const DEFAULT_ALLOWED_HOSTS = [
	"127.0.0.1:8788",
	"localhost:8788",
	"127.0.0.1:3000",
	"localhost:3000",
] as const;

export type OriginGuardDecision =
	| Readonly<{ allowed: true }>
	| Readonly<{ allowed: false; code: string }>;

function containsControlCharacter(value: string): boolean {
	for (const character of value) {
		const codePoint = character.codePointAt(0);
		if (codePoint !== undefined && (codePoint <= 31 || codePoint === 127)) {
			return true;
		}
	}
	return false;
}

function rawHeaderValues(
	request: IncomingMessage,
	targetName: string,
): string[] {
	const values: string[] = [];
	for (let index = 0; index < request.rawHeaders.length; index += 2) {
		const name = request.rawHeaders[index];
		const value = request.rawHeaders[index + 1];
		if (name?.toLowerCase() === targetName && value !== undefined) {
			values.push(value);
		}
	}
	return values;
}

function normalizeHost(
	value: string,
): { host: string; hostname: string } | null {
	if (
		value.length === 0 ||
		value !== value.trim() ||
		/[\\/@?#,\s]/u.test(value)
	) {
		return null;
	}
	try {
		const parsed = new URL(`http://${value}`);
		if (
			parsed.username !== "" ||
			parsed.password !== "" ||
			parsed.pathname !== "/"
		) {
			return null;
		}
		return {
			host: parsed.host.toLowerCase(),
			hostname: parsed.hostname.toLowerCase(),
		};
	} catch {
		return null;
	}
}

function isAllowedHost(
	normalized: { host: string; hostname: string },
	allowedHosts: readonly string[],
): boolean {
	return allowedHosts.some((allowed) => {
		const candidate = normalizeHost(allowed);
		if (candidate === null) {
			return false;
		}
		return allowed.includes(":")
			? candidate.host === normalized.host
			: candidate.hostname === normalized.hostname;
	});
}

function forwardedHostMatches(
	request: IncomingMessage,
	expectedHost: string,
): boolean {
	const xForwardedHosts = rawHeaderValues(request, "x-forwarded-host");
	if (xForwardedHosts.length > 1) {
		return false;
	}
	if (xForwardedHosts[0] !== undefined) {
		const forwarded = normalizeHost(xForwardedHosts[0]);
		if (forwarded?.host !== expectedHost) {
			return false;
		}
	}

	const forwardedHeaders = rawHeaderValues(request, "forwarded");
	if (forwardedHeaders.length > 1) {
		return false;
	}
	const forwardedHeader = forwardedHeaders[0];
	if (forwardedHeader === undefined) {
		return true;
	}
	const hostMatches = [
		...forwardedHeader.matchAll(
			/(?:^|[;,]\s*)host=(?:"([^"]+)"|([^;,\s]+))/giu,
		),
	];
	if (hostMatches.length !== 1) {
		return false;
	}
	const value = hostMatches[0]?.[1] ?? hostMatches[0]?.[2];
	return value !== undefined && normalizeHost(value)?.host === expectedHost;
}

function originMatches(
	request: IncomingMessage,
	expectedHost: string,
): boolean {
	const origins = rawHeaderValues(request, "origin");
	if (origins.length === 0) {
		return true;
	}
	if (origins.length !== 1 || origins[0] === undefined) {
		return false;
	}
	try {
		const origin = new URL(origins[0]);
		return (
			(origin.protocol === "http:" || origin.protocol === "https:") &&
			origin.username === "" &&
			origin.password === "" &&
			origin.pathname === "/" &&
			origin.search === "" &&
			origin.hash === "" &&
			origin.host.toLowerCase() === expectedHost
		);
	} catch {
		return false;
	}
}

export function validateRuntimeRequest(
	request: IncomingMessage,
	allowedHosts: readonly string[] = DEFAULT_ALLOWED_HOSTS,
): OriginGuardDecision {
	const target = request.url;
	if (
		target === undefined ||
		!target.startsWith("/") ||
		target.startsWith("//") ||
		target.includes("\\") ||
		containsControlCharacter(target)
	) {
		return { allowed: false, code: "invalid_request_target" };
	}

	const hosts = rawHeaderValues(request, "host");
	if (hosts.length !== 1 || hosts[0] === undefined) {
		return { allowed: false, code: "invalid_host" };
	}
	const host = normalizeHost(hosts[0]);
	if (host === null || !isAllowedHost(host, allowedHosts)) {
		return { allowed: false, code: "host_not_allowed" };
	}
	if (!forwardedHostMatches(request, host.host)) {
		return { allowed: false, code: "forwarded_host_mismatch" };
	}
	if (!originMatches(request, host.host)) {
		return { allowed: false, code: "origin_mismatch" };
	}
	return { allowed: true };
}
