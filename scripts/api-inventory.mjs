// Registration-only inventory: never listen, inject requests, load .env files,
// initialize a database client, run startup jobs, or contact identity providers.
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isDeepStrictEqual } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(resolve(root, "server/package.json"));
const ts = require("typescript");
const sha = value => createHash("sha256").update(value).digest("hex");
const portable = value => value.split(sep).join("/");
const sourcePath = file => portable(relative(root, file));
const routeMethods = new Set(["get", "head", "post", "put", "patch", "delete", "options", "all", "route"]);
const concise = node => node.getText().replace(/\s+/g, " ").slice(0, 350);

// Explicit protocol exceptions, not a blanket namespace exemption. A local
// source declaration at any of these paths remains an ordinary operation.
const documentationOperations = new Set([
  "GET /api/docs", "HEAD /api/docs", "HEAD /api/docs/",
  ...["/api/docs/json", "/api/docs/yaml", "/api/docs/static/*", "/api/docs/static/index.html", "/api/docs/static/swagger-initializer.js"]
    .flatMap(path => [`GET ${path}`, `HEAD ${path}`]),
]);

export function describeRouteRegistration({ method, path, source, authenticated = false, stack = "" }) {
  let infrastructure = false;
  if (!source) {
    // The stack is captured synchronously by our own onRoute hook, never taken
    // from a request. Swagger UI delegates its wildcard asset route to static.
    const frame = portable(stack).match(/(node_modules\/@fastify\/(swagger-ui|static)\/[^\s():]+):(\d+):\d+/);
    if (!documentationOperations.has(`${method} ${path}`) || !frame)
      throw new Error(`Unattributed runtime route: ${method} ${path}`);
    const packageName = `@fastify/${frame[2]}`;
    const expectedPackage = path === "/api/docs/static/*" ? "@fastify/static" : "@fastify/swagger-ui";
    if (packageName !== expectedPackage)
      throw new Error(`Unattributed runtime route: ${method} ${path}; unexpected documentation plugin ${packageName}`);
    const packageVersion = require(`${packageName}/package.json`).version;
    source = {
      file: frame[1], line: Number(frame[3]),
      package: { name: packageName, version: packageVersion },
      registrationHash: sha(JSON.stringify({ method, path, file: frame[1], line: Number(frame[3]), packageVersion })),
      registrationMethod: "plugin",
      evidence: { authorization: [], input: [], response: [], errors: [], helpers: [] },
    };
    infrastructure = true;
  }
  const protocol = infrastructure ? "documentation-infrastructure" : path.startsWith("/api/auth/") ? "authentication-session"
    : ["/", "/api/health", "/api/ready"].includes(path) ? "health"
    : path === "/api/telemetry" ? "telemetry" : "business";
  return {
    source, protocol,
    authentication: infrastructure ? "inherited-onRequest-documentation-gate" : authenticated ? "preValidation-hook" : "no-route-preValidation-hook",
    supportMode: infrastructure ? "explicitly-denied" : !authenticated ? "not-session-authenticated"
      : path === "/api/auth/logout" || path === "/api/impersonation" && method === "DELETE" ? "exit-exception"
      : path === "/api/telemetry" ? "telemetry-write-exception"
      : ["GET", "HEAD", "OPTIONS"].includes(method) ? "fresh-session-and-target-scope" : "centrally-read-only",
  };
}

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? sourceFiles(resolve(directory, entry.name))
    : entry.name.endsWith(".ts") ? [resolve(directory, entry.name)] : []))).flat().sort();
}

function summarizeEvidence(records) {
  const all = Object.values(records).flat();
  const unique = values => [...new Set(values)].sort((a, b) => typeof a === "number" ? a - b : a.localeCompare(b));
  const fields = location => all.flatMap(item => item.details?.requestField?.location === location ? [item.details.requestField.name] : []);
  return {
    observedPermissionCalls: unique(all.flatMap(item => typeof item.details?.permission === "string" ? [item.details.permission] : [])),
    bodyKeys: unique([...fields("body"), ...all.flatMap(item => item.details?.allowedBodyFields?.values || [])]),
    queryKeys: unique(fields("query")),
    headerKeys: unique(fields("header")),
    statuses: unique(all.flatMap(item => typeof item.details?.possibleStatus === "number" ? [item.details.possibleStatus] : [])),
    errorCodes: unique(all.flatMap(item => typeof item.details?.errorCode === "string" ? [item.details.errorCode] : [])),
    sourceEvidence: {
      // Locate the direct parser/wrapper/return without copying its source code.
      input: records.input.find(item => item.symbol === "input") ? [records.input.find(item => item.symbol === "input")].map(({ file, line }) => `${file}:${line}`) : [],
      authorization: records.authorization.slice(0, 1).map(({ file, line }) => `${file}:${line}`),
      response: records.response.slice(0, 1).map(({ file, line }) => `${file}:${line}`),
      unresolvedBodyKeys: unique(all.flatMap(item => item.details?.allowedBodyFields?.unresolved || [])),
    },
  };
}

export function runtimeInventory(inventory) {
  return {
    format: 1,
    routes: inventory.routes.filter(route => !route.generatedHead && route.protocol !== "documentation-infrastructure").map(route => ({
      operation: route.operation, method: route.method, path: route.path,
      protocol: route.protocol, source: { file: route.source.file, line: route.source.line },
      authentication: route.authentication, supportMode: route.supportMode,
      observedPermissionCalls: route.observedPermissionCalls,
      bodyKeys: route.bodyKeys, queryKeys: route.queryKeys, headerKeys: route.headerKeys,
      statuses: route.statuses, errorCodes: route.errorCodes,
      registeredSchemaParts: route.registeredSchemaParts,
      handlerHash: route.source.registrationHash,
      reviewStatus: "unverified-source-evidence",
    })),
  };
}

export function manifestInventory(inventory) {
  const { document: _document, ...record } = inventory;
  return {
    ...record,
    routes: inventory.routes.map(route => route.generatedHead ? {
      operation: route.operation, method: route.method, path: route.path,
      generatedHead: true, inherits: `GET ${route.path}`, protocol: route.protocol,
    } : route),
  };
}

function evidence(checker, handler) {
  const records = { authorization: [], input: [], response: [], errors: [], helpers: [] };
  const visited = new Set();
  const literal = node => node && (ts.isStringLiteralLike(node) ? node.text : ts.isNumericLiteral(node) ? Number(node.text) : undefined);
  const symbolDeclaration = node => {
    let symbol = checker.getSymbolAtLocation(node);
    if (symbol && (symbol.flags & ts.SymbolFlags.Alias)) symbol = checker.getAliasedSymbol(symbol);
    return symbol?.declarations?.find(declaration => ts.isVariableDeclaration(declaration) || ts.isFunctionDeclaration(declaration));
  };
  function declaredStrings(node, seen = new Set()) {
    if (!node || seen.has(node)) return { values: [], unresolved: [] };
    seen.add(node);
    if (ts.isStringLiteralLike(node)) return { values: [node.text], unresolved: [] };
    if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node) || ts.isSpreadElement(node)) return declaredStrings(node.expression, seen);
    if (ts.isArrayLiteralExpression(node)) {
      const results = node.elements.map(item => declaredStrings(item, new Set(seen)));
      return { values: results.flatMap(item => item.values), unresolved: results.flatMap(item => item.unresolved) };
    }
    if (ts.isIdentifier(node)) {
      const declaration = symbolDeclaration(node);
      if (declaration?.initializer) return declaredStrings(declaration.initializer, seen);
    }
    if (ts.isCallExpression(node) && node.expression.getText() === "Object.keys") {
      let target = node.arguments[0];
      if (target && ts.isIdentifier(target)) target = symbolDeclaration(target)?.initializer;
      if (target && ts.isObjectLiteralExpression(target)) return { values: target.properties.map(property => property.name?.getText().replace(/^["']|["']$/g, "")).filter(Boolean), unresolved: [] };
    }
    return { values: [], unresolved: [concise(node)] };
  }
  function inputAccess(node) {
    if (!ts.isPropertyAccessExpression(node) && !ts.isElementAccessExpression(node)) return undefined;
    let target = node.expression.getText();
    if (ts.isIdentifier(node.expression)) {
      target = symbolDeclaration(node.expression)?.initializer?.getText() || target;
      if (/^(?:input|bodyOf)\(/.test(target)) target = "request.body";
    }
    const location = { "request.body": "body", "request.query": "query", "request.params": "path", "request.headers": "header" }[target];
    if (!location) return undefined;
    const name = ts.isPropertyAccessExpression(node) ? node.name.text : literal(node.argumentExpression);
    return name === undefined ? undefined : { location, name };
  }
  const ref = (node, symbol, details) => ({
    file: sourcePath(node.getSourceFile().fileName),
    line: node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1,
    symbol,
    ...(details ? { details } : {}),
  });
  function inspect(node, depth = 0) {
    if (!node || visited.has(node)) return;
    visited.add(node);
    function walk(current) {
      if (ts.isCallExpression(current)) {
        const name = current.expression.getText();
        if (/^(?:requirePermission|companyScope|scoped|scope|revalidateImpersonation|requireFeatures|checked|authorized|authenticate|mutation|tenantTransaction|serializable)$/.test(name))
          records.authorization.push(ref(current, name, { permission: literal(current.arguments[name === "scoped" ? 2 : 1]) ?? null }));
        if (name === "input") records.input.push(ref(current, name, { allowedBodyFields: declaredStrings(current.arguments[1]) }));
        if (/\.(?:code|status)$/.test(name)) records.response.push(ref(current, name, { possibleStatus: literal(current.arguments[0]) ?? null }));
        if (ts.isIdentifier(current.expression)) {
          const declaration = symbolDeclaration(current.expression);
          const body = declaration && (ts.isFunctionDeclaration(declaration) ? declaration.body
            : declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)) ? declaration.initializer.body : undefined);
          if (body && !/^(?:register|seed|buildDemo)/.test(name) && declaration.getSourceFile().fileName.startsWith(resolve(root, "server/src"))) {
            records.helpers.push(ref(declaration, name));
            // One helper layer supplies evidence for checked()/scope() wrappers.
            // Shared framework policy is documented once, not copied per route.
            if (depth === 0) inspect(body, 1);
          }
        }
      }
      if (ts.isNewExpression(current) && current.expression.getText() === "AccessError")
        records.errors.push(ref(current, "AccessError", { possibleStatus: literal(current.arguments?.[0]) ?? null, errorCode: literal(current.arguments?.[1]) ?? null }));
      if (ts.isReturnStatement(current) && current.expression && depth === 0) records.response.push(ref(current, "return"));
      const field = inputAccess(current);
      if (field) records.input.push(ref(current, "request-field", { requestField: field }));
      ts.forEachChild(current, walk);
    }
    walk(node);
  }
  inspect(handler);
  for (const key of Object.keys(records)) records[key] = [...new Map(records[key].map(item => [JSON.stringify(item), item])).values()];
  return records;
}

export async function captureInventory({ includeDocument = false } = {}) {
  const files = await sourceFiles(resolve(root, "server/src"));
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext, skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const sourceRecords = new Map();
  const registrationRecords = new Map();
  const observedRegistrations = new Set();
  const runtime = [];
  const modules = new Map();
  const servers = [];
  const blockedStartupHooks = [];
  let currentRegistration;
  const registration = (id, call) => {
    const previous = currentRegistration;
    currentRegistration = registrationRecords.get(id);
    observedRegistrations.add(id);
    try { return call(); } finally { currentRegistration = previous; }
  };
  const forbidden = operation => { throw new Error(`Inventory must not execute ${operation}.`); };
  const db = new Proxy({}, { get: (_target, key) => forbidden(`database access (${String(key)})`) });
  const safeProcess = {
    env: {
      APP_ORIGIN: "https://inventory.invalid", AUTH0_DOMAIN: "identity.invalid",
      AUTH0_WEB_CLIENT_ID: "inventory-only", AUTH0_WEB_CLIENT_SECRET: "inventory-only",
      OTEL_SDK_DISABLED: "true", NODE_ENV: "test",
    },
    once: () => {}, exit: () => forbidden("process exit"),
    uptime: process.uptime.bind(process), memoryUsage: process.memoryUsage.bind(process),
    cpuUsage: process.cpuUsage.bind(process),
  };
  const fastify = require("fastify");
  function inventoryFastify(options) {
    const server = fastify(options);
    servers.push(server);
    server.addHook("onRoute", route => {
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        runtime.push({
          method, path: route.url,
          ...describeRouteRegistration({ method, path: route.url, source: currentRegistration,
            authenticated: !!route.preValidation, stack: new Error().stack || "" }),
          schemaParts: Object.keys(route.schema || {}).sort(),
          bodyLimit: route.bodyLimit ?? options?.bodyLimit ?? null,
        });
      }
    });
    const addHook = server.addHook;
    server.addHook = function (name, ...args) {
      // This maintained plugin hook only prepares shared-schema references for
      // swagger(). Keep application startup jobs suppressed, including billing.
      const swaggerPreparation = name === "onReady" && portable(new Error().stack || "").includes("/@fastify/swagger/lib/util/add-hook.js:");
      if (["onReady", "onListen"].includes(name)) {
        if (swaggerPreparation) return addHook.call(this, name, ...args);
        blockedStartupHooks.push(name);
        return this;
      }
      return addHook.call(this, name, ...args);
    };
    server.listen = async () => undefined;
    server.inject = () => forbidden("request injection");
    return server;
  }
  function compile(file) {
    const ast = program.getSourceFile(file);
    if (!ast) throw new Error(`Source changed during inventory capture: ${sourcePath(file)} is not in the TypeScript snapshot. Retry after editing finishes.`);
    const text = ast.text;
    const originalCalls = new Map();
    const collectCalls = node => {
      if (ts.isCallExpression(node)) originalCalls.set(node.pos, node);
      ts.forEachChild(node, collectCalls);
    };
    collectCalls(ast);
    sourceRecords.set(sourcePath(file), sha(text));
    const instrument = context => astRoot => {
      const visit = node => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText() === "server" && routeMethods.has(node.expression.name.text)) {
          const id = `${sourcePath(file)}:${node.pos}`;
          const original = originalCalls.get(node.pos);
          if (!original) throw new Error(`Source snapshot mismatch: ${id}`);
          const handler = original.arguments.at(-1);
          registrationRecords.set(id, {
            file: sourcePath(file), line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            registrationHash: sha(node.getText()),
            registrationMethod: node.expression.name.text,
            evidence: evidence(checker, handler),
          });
          return context.factory.createCallExpression(context.factory.createIdentifier("__inventoryRegistration"), undefined, [
            context.factory.createStringLiteral(id),
            context.factory.createArrowFunction(undefined, undefined, [], undefined,
              context.factory.createToken(ts.SyntaxKind.EqualsGreaterThanToken), ts.visitEachChild(node, visit, context)),
          ]);
        }
        return ts.visitEachChild(node, visit, context);
      };
      return ts.visitNode(astRoot, visit);
    };
    return ts.transpileModule(text, {
      fileName: file,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
      transformers: { before: [instrument] },
    }).outputText;
  }
  function load(name, from) {
    if (!name.startsWith(".")) {
      if (name === "fastify") return inventoryFastify;
      if (name === "dotenv") return { config: () => ({ parsed: {} }) };
      return require(name);
    }
    const file = resolve(dirname(from), name.replace(/\.js$/, ".ts"));
    if (file === resolve(root, "server/src/lib/prisma.ts")) return { prisma: db };
    if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
    if (modules.has(file)) return modules.get(file).exports;
    const module = { exports: {} };
    modules.set(file, module);
    const code = compile(file);
    // Imported files have no top-level await. The production index is evaluated
    // separately below so its genuine async plugin-registration order is kept.
    new Function("require", "module", "exports", "__filename", "__dirname", "process", "__inventoryRegistration", code)(
      imported => load(imported, file), module, module.exports, file, dirname(file), safeProcess, registration,
    );
    return module.exports;
  }
  try {
    const entry = resolve(root, "server/src/index.ts");
    const code = compile(entry);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const module = { exports: {} };
    await new AsyncFunction("require", "module", "exports", "__filename", "__dirname", "process", "__inventoryRegistration", code)(
      imported => load(imported, entry), module, module.exports, entry, dirname(entry), safeProcess, registration,
    );
    // Finish pending plugin registrations and structural schema compilation.
    // The wrapper above has removed application startup jobs before this runs.
    await servers[0].ready();
    let document;
    if (includeDocument) {
      document = servers[0].swagger();
    }
    for (const [file, hash] of sourceRecords)
      if (sha(readFileSync(resolve(root, file), "utf8")) !== hash)
        throw new Error(`Source changed during inventory capture: ${file}. Retry after editing finishes.`);
    const sourceDeclarations = [];
    for (const file of files) {
      const ast = program.getSourceFile(file);
      const visit = node => {
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
          node.expression.expression.getText() === "server" && routeMethods.has(node.expression.name.text))
          sourceDeclarations.push({ id: `${sourcePath(file)}:${node.pos}`, file: sourcePath(file), line: ast.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
    const unobservedDeclarations = sourceDeclarations.filter(source => !observedRegistrations.has(source.id))
      .map(({ file, line }) => ({ file, line }));
    if (unobservedDeclarations.length)
      throw new Error(`Route declarations were not observed in the controlled production composition: ${JSON.stringify(unobservedDeclarations)}. Review conditional registration and record an explicit supported variant before regenerating.`);
    const seen = new Set();
    const routes = runtime.map(row => {
      const key = `${row.method} ${row.path}`;
      if (seen.has(key)) throw new Error(`Duplicate registered operation: ${key}`);
      seen.add(key);
      return {
        operation: key, method: row.method, path: row.path,
        generatedHead: row.method === "HEAD" && row.source.registrationMethod === "get",
        protocol: row.protocol,
        source: { file: row.source.file, line: row.source.line, registrationHash: row.source.registrationHash, ...(row.source.package ? { package: row.source.package } : {}) },
        authentication: row.authentication,
        supportMode: row.supportMode,
        bodyLimit: row.bodyLimit,
        registeredSchemaParts: row.schemaParts,
        ...summarizeEvidence(row.source.evidence),
        contractReview: "source-evidence-only",
      };
    }).sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
    return {
      format: 2,
      generation: {
        entrypoint: "server/src/index.ts",
        configuration: "Controlled production entrypoint composition with synthetic Auth0/origin configuration, NODE_ENV=test and telemetry export disabled; index.ts passes no salesDemo override, so salesDemo registration defaults to true. This is source registration, not a live environment inventory.",
        method: "actual Fastify onRoute registration; TypeScript source evidence",
        safety: "No handlers, database clients, .env loading, provider calls, socket listeners or startup jobs executed.",
        limitations: [
          "Source summaries inspect the handler and one identifier-called helper layer. Dynamic branches, deeper/property-called helpers, requiredness and runtime projections require explicit contract review.",
          "Return expressions and TypeScript annotations are source evidence, not verified response schemas or declared HTTP outcomes.",
          "A preValidation hook is recorded structurally; source/session authorization still requires operation review.",
          "All static server.method route declarations under server/src must execute in the controlled composition. Runtime-only/dynamic registration aliases and live environment-specific exposure still require review.",
          "HEAD operations are generated by Fastify for GET handlers; the not-found/error handlers are cross-cutting behavior, not registered operations.",
        ],
        suppressedStartupHooks: blockedStartupHooks,
        observedSourceRegistrationSites: observedRegistrations.size,
        staticSourceRegistrationSites: sourceDeclarations.length,
        unobservedSourceRegistrationSites: unobservedDeclarations,
      },
      summary: {
        totalOperations: routes.length,
        explicitOperations: routes.filter(row => !row.generatedHead).length,
        generatedHeadOperations: routes.filter(row => row.generatedHead).length,
        withRegisteredSchema: routes.filter(row => row.registeredSchemaParts.length).length,
        withRegisteredNonDocumentationSchema: routes.filter(row => row.protocol !== "documentation-infrastructure" && row.registeredSchemaParts.length).length,
        explicitNonDocumentationOperations: routes.filter(row => !row.generatedHead && row.protocol !== "documentation-infrastructure").length,
        sourceOnlyContractReviews: routes.length,
        byMethod: Object.fromEntries([...new Set(routes.map(row => row.method))].sort().map(method => [method, routes.filter(row => row.method === method).length])),
        byProtocol: Object.fromEntries([...new Set(routes.map(row => row.protocol))].sort().map(protocol => [protocol, routes.filter(row => row.protocol === protocol).length])),
      },
      sourceFiles: [...sourceRecords.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([file, hash]) => ({ file, sha256: hash })),
      routes,
      ...(includeDocument ? { document } : {}),
    };
  } finally {
    for (const server of servers) await server.close();
  }
}

export function inventoryDrift(expected, actual) {
  const before = new Map(expected.routes.map(route => [route.operation, route]));
  const after = new Map(actual.routes.map(route => [route.operation, route]));
  return {
    added: [...after.keys()].filter(key => !before.has(key)),
    removed: [...before.keys()].filter(key => !after.has(key)),
    changed: [...after.keys()].filter(key => before.has(key) && !isDeepStrictEqual(before.get(key), after.get(key))),
    sourceChanged: !isDeepStrictEqual(expected.sourceFiles, actual.sourceFiles),
  };
}

async function main() {
  const argument = process.argv[2] || "--check";
  if (!["--write", "--check", "--summary"].includes(argument)) throw new Error("Use --write, --check or --summary.");
  const inventory = await captureInventory();
  const target = resolve(root, "docs/api/route-inventory.json");
  if (argument === "--write") {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(manifestInventory(inventory), null, 2)}\n`);
    const runtimeTarget = resolve(root, "server/src/api/route-inventory.json");
    await mkdir(dirname(runtimeTarget), { recursive: true });
    await writeFile(runtimeTarget, `${JSON.stringify(runtimeInventory(inventory))}\n`);
    console.log(`Wrote ${sourcePath(target)}: ${JSON.stringify(inventory.summary)}`);
  } else if (argument === "--summary") console.log(JSON.stringify(inventory.summary, null, 2));
  else {
    const expected = JSON.parse(await readFile(target, "utf8"));
    const actual = manifestInventory(inventory);
    const runtimeExpected = JSON.parse(await readFile(resolve(root, "server/src/api/route-inventory.json"), "utf8"));
    if (!isDeepStrictEqual(expected, actual) || !isDeepStrictEqual(runtimeExpected, runtimeInventory(inventory))) {
      console.error(`API inventory drift: ${JSON.stringify(inventoryDrift(expected, actual))}`);
      console.error("Review changed registrations/contracts, then run node scripts/api-inventory.mjs --write.");
      process.exitCode = 1;
    } else console.log(`API inventory matches ${inventory.summary.totalOperations} registered operations.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
