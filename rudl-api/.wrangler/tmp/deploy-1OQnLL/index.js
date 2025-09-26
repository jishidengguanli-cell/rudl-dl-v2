var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// node_modules/hono/dist/compose.js
var compose = /* @__PURE__ */ __name((middleware, onError, onNotFound) => {
  return (context, next) => {
    let index = -1;
    return dispatch(0);
    async function dispatch(i) {
      if (i <= index) {
        throw new Error("next() called multiple times");
      }
      index = i;
      let res;
      let isError = false;
      let handler;
      if (middleware[i]) {
        handler = middleware[i][0][0];
        context.req.routeIndex = i;
      } else {
        handler = i === middleware.length && next || void 0;
      }
      if (handler) {
        try {
          res = await handler(context, () => dispatch(i + 1));
        } catch (err) {
          if (err instanceof Error && onError) {
            context.error = err;
            res = await onError(err, context);
            isError = true;
          } else {
            throw err;
          }
        }
      } else {
        if (context.finalized === false && onNotFound) {
          res = await onNotFound(context);
        }
      }
      if (res && (context.finalized === false || isError)) {
        context.res = res;
      }
      return context;
    }
    __name(dispatch, "dispatch");
  };
}, "compose");

// node_modules/hono/dist/request/constants.js
var GET_MATCH_RESULT = Symbol();

// node_modules/hono/dist/utils/body.js
var parseBody = /* @__PURE__ */ __name(async (request, options = /* @__PURE__ */ Object.create(null)) => {
  const { all = false, dot = false } = options;
  const headers = request instanceof HonoRequest ? request.raw.headers : request.headers;
  const contentType = headers.get("Content-Type");
  if (contentType?.startsWith("multipart/form-data") || contentType?.startsWith("application/x-www-form-urlencoded")) {
    return parseFormData(request, { all, dot });
  }
  return {};
}, "parseBody");
async function parseFormData(request, options) {
  const formData = await request.formData();
  if (formData) {
    return convertFormDataToBodyData(formData, options);
  }
  return {};
}
__name(parseFormData, "parseFormData");
function convertFormDataToBodyData(formData, options) {
  const form = /* @__PURE__ */ Object.create(null);
  formData.forEach((value, key) => {
    const shouldParseAllValues = options.all || key.endsWith("[]");
    if (!shouldParseAllValues) {
      form[key] = value;
    } else {
      handleParsingAllValues(form, key, value);
    }
  });
  if (options.dot) {
    Object.entries(form).forEach(([key, value]) => {
      const shouldParseDotValues = key.includes(".");
      if (shouldParseDotValues) {
        handleParsingNestedValues(form, key, value);
        delete form[key];
      }
    });
  }
  return form;
}
__name(convertFormDataToBodyData, "convertFormDataToBodyData");
var handleParsingAllValues = /* @__PURE__ */ __name((form, key, value) => {
  if (form[key] !== void 0) {
    if (Array.isArray(form[key])) {
      ;
      form[key].push(value);
    } else {
      form[key] = [form[key], value];
    }
  } else {
    if (!key.endsWith("[]")) {
      form[key] = value;
    } else {
      form[key] = [value];
    }
  }
}, "handleParsingAllValues");
var handleParsingNestedValues = /* @__PURE__ */ __name((form, key, value) => {
  let nestedForm = form;
  const keys = key.split(".");
  keys.forEach((key2, index) => {
    if (index === keys.length - 1) {
      nestedForm[key2] = value;
    } else {
      if (!nestedForm[key2] || typeof nestedForm[key2] !== "object" || Array.isArray(nestedForm[key2]) || nestedForm[key2] instanceof File) {
        nestedForm[key2] = /* @__PURE__ */ Object.create(null);
      }
      nestedForm = nestedForm[key2];
    }
  });
}, "handleParsingNestedValues");

// node_modules/hono/dist/utils/url.js
var splitPath = /* @__PURE__ */ __name((path) => {
  const paths = path.split("/");
  if (paths[0] === "") {
    paths.shift();
  }
  return paths;
}, "splitPath");
var splitRoutingPath = /* @__PURE__ */ __name((routePath) => {
  const { groups, path } = extractGroupsFromPath(routePath);
  const paths = splitPath(path);
  return replaceGroupMarks(paths, groups);
}, "splitRoutingPath");
var extractGroupsFromPath = /* @__PURE__ */ __name((path) => {
  const groups = [];
  path = path.replace(/\{[^}]+\}/g, (match, index) => {
    const mark = `@${index}`;
    groups.push([mark, match]);
    return mark;
  });
  return { groups, path };
}, "extractGroupsFromPath");
var replaceGroupMarks = /* @__PURE__ */ __name((paths, groups) => {
  for (let i = groups.length - 1; i >= 0; i--) {
    const [mark] = groups[i];
    for (let j = paths.length - 1; j >= 0; j--) {
      if (paths[j].includes(mark)) {
        paths[j] = paths[j].replace(mark, groups[i][1]);
        break;
      }
    }
  }
  return paths;
}, "replaceGroupMarks");
var patternCache = {};
var getPattern = /* @__PURE__ */ __name((label, next) => {
  if (label === "*") {
    return "*";
  }
  const match = label.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
  if (match) {
    const cacheKey = `${label}#${next}`;
    if (!patternCache[cacheKey]) {
      if (match[2]) {
        patternCache[cacheKey] = next && next[0] !== ":" && next[0] !== "*" ? [cacheKey, match[1], new RegExp(`^${match[2]}(?=/${next})`)] : [label, match[1], new RegExp(`^${match[2]}$`)];
      } else {
        patternCache[cacheKey] = [label, match[1], true];
      }
    }
    return patternCache[cacheKey];
  }
  return null;
}, "getPattern");
var tryDecode = /* @__PURE__ */ __name((str, decoder) => {
  try {
    return decoder(str);
  } catch {
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
      try {
        return decoder(match);
      } catch {
        return match;
      }
    });
  }
}, "tryDecode");
var tryDecodeURI = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURI), "tryDecodeURI");
var getPath = /* @__PURE__ */ __name((request) => {
  const url = request.url;
  const start = url.indexOf("/", url.indexOf(":") + 4);
  let i = start;
  for (; i < url.length; i++) {
    const charCode = url.charCodeAt(i);
    if (charCode === 37) {
      const queryIndex = url.indexOf("?", i);
      const path = url.slice(start, queryIndex === -1 ? void 0 : queryIndex);
      return tryDecodeURI(path.includes("%25") ? path.replace(/%25/g, "%2525") : path);
    } else if (charCode === 63) {
      break;
    }
  }
  return url.slice(start, i);
}, "getPath");
var getPathNoStrict = /* @__PURE__ */ __name((request) => {
  const result = getPath(request);
  return result.length > 1 && result.at(-1) === "/" ? result.slice(0, -1) : result;
}, "getPathNoStrict");
var mergePath = /* @__PURE__ */ __name((base, sub, ...rest) => {
  if (rest.length) {
    sub = mergePath(sub, ...rest);
  }
  return `${base?.[0] === "/" ? "" : "/"}${base}${sub === "/" ? "" : `${base?.at(-1) === "/" ? "" : "/"}${sub?.[0] === "/" ? sub.slice(1) : sub}`}`;
}, "mergePath");
var checkOptionalParameter = /* @__PURE__ */ __name((path) => {
  if (path.charCodeAt(path.length - 1) !== 63 || !path.includes(":")) {
    return null;
  }
  const segments = path.split("/");
  const results = [];
  let basePath = "";
  segments.forEach((segment) => {
    if (segment !== "" && !/\:/.test(segment)) {
      basePath += "/" + segment;
    } else if (/\:/.test(segment)) {
      if (/\?/.test(segment)) {
        if (results.length === 0 && basePath === "") {
          results.push("/");
        } else {
          results.push(basePath);
        }
        const optionalSegment = segment.replace("?", "");
        basePath += "/" + optionalSegment;
        results.push(basePath);
      } else {
        basePath += "/" + segment;
      }
    }
  });
  return results.filter((v, i, a) => a.indexOf(v) === i);
}, "checkOptionalParameter");
var _decodeURI = /* @__PURE__ */ __name((value) => {
  if (!/[%+]/.test(value)) {
    return value;
  }
  if (value.indexOf("+") !== -1) {
    value = value.replace(/\+/g, " ");
  }
  return value.indexOf("%") !== -1 ? tryDecode(value, decodeURIComponent_) : value;
}, "_decodeURI");
var _getQueryParam = /* @__PURE__ */ __name((url, key, multiple) => {
  let encoded;
  if (!multiple && key && !/[%+]/.test(key)) {
    let keyIndex2 = url.indexOf(`?${key}`, 8);
    if (keyIndex2 === -1) {
      keyIndex2 = url.indexOf(`&${key}`, 8);
    }
    while (keyIndex2 !== -1) {
      const trailingKeyCode = url.charCodeAt(keyIndex2 + key.length + 1);
      if (trailingKeyCode === 61) {
        const valueIndex = keyIndex2 + key.length + 2;
        const endIndex = url.indexOf("&", valueIndex);
        return _decodeURI(url.slice(valueIndex, endIndex === -1 ? void 0 : endIndex));
      } else if (trailingKeyCode == 38 || isNaN(trailingKeyCode)) {
        return "";
      }
      keyIndex2 = url.indexOf(`&${key}`, keyIndex2 + 1);
    }
    encoded = /[%+]/.test(url);
    if (!encoded) {
      return void 0;
    }
  }
  const results = {};
  encoded ??= /[%+]/.test(url);
  let keyIndex = url.indexOf("?", 8);
  while (keyIndex !== -1) {
    const nextKeyIndex = url.indexOf("&", keyIndex + 1);
    let valueIndex = url.indexOf("=", keyIndex);
    if (valueIndex > nextKeyIndex && nextKeyIndex !== -1) {
      valueIndex = -1;
    }
    let name = url.slice(
      keyIndex + 1,
      valueIndex === -1 ? nextKeyIndex === -1 ? void 0 : nextKeyIndex : valueIndex
    );
    if (encoded) {
      name = _decodeURI(name);
    }
    keyIndex = nextKeyIndex;
    if (name === "") {
      continue;
    }
    let value;
    if (valueIndex === -1) {
      value = "";
    } else {
      value = url.slice(valueIndex + 1, nextKeyIndex === -1 ? void 0 : nextKeyIndex);
      if (encoded) {
        value = _decodeURI(value);
      }
    }
    if (multiple) {
      if (!(results[name] && Array.isArray(results[name]))) {
        results[name] = [];
      }
      ;
      results[name].push(value);
    } else {
      results[name] ??= value;
    }
  }
  return key ? results[key] : results;
}, "_getQueryParam");
var getQueryParam = _getQueryParam;
var getQueryParams = /* @__PURE__ */ __name((url, key) => {
  return _getQueryParam(url, key, true);
}, "getQueryParams");
var decodeURIComponent_ = decodeURIComponent;

// node_modules/hono/dist/request.js
var tryDecodeURIComponent = /* @__PURE__ */ __name((str) => tryDecode(str, decodeURIComponent_), "tryDecodeURIComponent");
var HonoRequest = class {
  static {
    __name(this, "HonoRequest");
  }
  raw;
  #validatedData;
  #matchResult;
  routeIndex = 0;
  path;
  bodyCache = {};
  constructor(request, path = "/", matchResult = [[]]) {
    this.raw = request;
    this.path = path;
    this.#matchResult = matchResult;
    this.#validatedData = {};
  }
  param(key) {
    return key ? this.#getDecodedParam(key) : this.#getAllDecodedParams();
  }
  #getDecodedParam(key) {
    const paramKey = this.#matchResult[0][this.routeIndex][1][key];
    const param = this.#getParamValue(paramKey);
    return param && /\%/.test(param) ? tryDecodeURIComponent(param) : param;
  }
  #getAllDecodedParams() {
    const decoded = {};
    const keys = Object.keys(this.#matchResult[0][this.routeIndex][1]);
    for (const key of keys) {
      const value = this.#getParamValue(this.#matchResult[0][this.routeIndex][1][key]);
      if (value !== void 0) {
        decoded[key] = /\%/.test(value) ? tryDecodeURIComponent(value) : value;
      }
    }
    return decoded;
  }
  #getParamValue(paramKey) {
    return this.#matchResult[1] ? this.#matchResult[1][paramKey] : paramKey;
  }
  query(key) {
    return getQueryParam(this.url, key);
  }
  queries(key) {
    return getQueryParams(this.url, key);
  }
  header(name) {
    if (name) {
      return this.raw.headers.get(name) ?? void 0;
    }
    const headerData = {};
    this.raw.headers.forEach((value, key) => {
      headerData[key] = value;
    });
    return headerData;
  }
  async parseBody(options) {
    return this.bodyCache.parsedBody ??= await parseBody(this, options);
  }
  #cachedBody = /* @__PURE__ */ __name((key) => {
    const { bodyCache, raw: raw2 } = this;
    const cachedBody = bodyCache[key];
    if (cachedBody) {
      return cachedBody;
    }
    const anyCachedKey = Object.keys(bodyCache)[0];
    if (anyCachedKey) {
      return bodyCache[anyCachedKey].then((body) => {
        if (anyCachedKey === "json") {
          body = JSON.stringify(body);
        }
        return new Response(body)[key]();
      });
    }
    return bodyCache[key] = raw2[key]();
  }, "#cachedBody");
  json() {
    return this.#cachedBody("text").then((text) => JSON.parse(text));
  }
  text() {
    return this.#cachedBody("text");
  }
  arrayBuffer() {
    return this.#cachedBody("arrayBuffer");
  }
  blob() {
    return this.#cachedBody("blob");
  }
  formData() {
    return this.#cachedBody("formData");
  }
  addValidatedData(target, data) {
    this.#validatedData[target] = data;
  }
  valid(target) {
    return this.#validatedData[target];
  }
  get url() {
    return this.raw.url;
  }
  get method() {
    return this.raw.method;
  }
  get [GET_MATCH_RESULT]() {
    return this.#matchResult;
  }
  get matchedRoutes() {
    return this.#matchResult[0].map(([[, route]]) => route);
  }
  get routePath() {
    return this.#matchResult[0].map(([[, route]]) => route)[this.routeIndex].path;
  }
};

// node_modules/hono/dist/utils/html.js
var HtmlEscapedCallbackPhase = {
  Stringify: 1,
  BeforeStream: 2,
  Stream: 3
};
var raw = /* @__PURE__ */ __name((value, callbacks) => {
  const escapedString = new String(value);
  escapedString.isEscaped = true;
  escapedString.callbacks = callbacks;
  return escapedString;
}, "raw");
var resolveCallback = /* @__PURE__ */ __name(async (str, phase, preserveCallbacks, context, buffer) => {
  if (typeof str === "object" && !(str instanceof String)) {
    if (!(str instanceof Promise)) {
      str = str.toString();
    }
    if (str instanceof Promise) {
      str = await str;
    }
  }
  const callbacks = str.callbacks;
  if (!callbacks?.length) {
    return Promise.resolve(str);
  }
  if (buffer) {
    buffer[0] += str;
  } else {
    buffer = [str];
  }
  const resStr = Promise.all(callbacks.map((c) => c({ phase, buffer, context }))).then(
    (res) => Promise.all(
      res.filter(Boolean).map((str2) => resolveCallback(str2, phase, false, context, buffer))
    ).then(() => buffer[0])
  );
  if (preserveCallbacks) {
    return raw(await resStr, callbacks);
  } else {
    return resStr;
  }
}, "resolveCallback");

// node_modules/hono/dist/context.js
var TEXT_PLAIN = "text/plain; charset=UTF-8";
var setDefaultContentType = /* @__PURE__ */ __name((contentType, headers) => {
  return {
    "Content-Type": contentType,
    ...headers
  };
}, "setDefaultContentType");
var Context = class {
  static {
    __name(this, "Context");
  }
  #rawRequest;
  #req;
  env = {};
  #var;
  finalized = false;
  error;
  #status;
  #executionCtx;
  #res;
  #layout;
  #renderer;
  #notFoundHandler;
  #preparedHeaders;
  #matchResult;
  #path;
  constructor(req, options) {
    this.#rawRequest = req;
    if (options) {
      this.#executionCtx = options.executionCtx;
      this.env = options.env;
      this.#notFoundHandler = options.notFoundHandler;
      this.#path = options.path;
      this.#matchResult = options.matchResult;
    }
  }
  get req() {
    this.#req ??= new HonoRequest(this.#rawRequest, this.#path, this.#matchResult);
    return this.#req;
  }
  get event() {
    if (this.#executionCtx && "respondWith" in this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no FetchEvent");
    }
  }
  get executionCtx() {
    if (this.#executionCtx) {
      return this.#executionCtx;
    } else {
      throw Error("This context has no ExecutionContext");
    }
  }
  get res() {
    return this.#res ||= new Response(null, {
      headers: this.#preparedHeaders ??= new Headers()
    });
  }
  set res(_res) {
    if (this.#res && _res) {
      _res = new Response(_res.body, _res);
      for (const [k, v] of this.#res.headers.entries()) {
        if (k === "content-type") {
          continue;
        }
        if (k === "set-cookie") {
          const cookies = this.#res.headers.getSetCookie();
          _res.headers.delete("set-cookie");
          for (const cookie of cookies) {
            _res.headers.append("set-cookie", cookie);
          }
        } else {
          _res.headers.set(k, v);
        }
      }
    }
    this.#res = _res;
    this.finalized = true;
  }
  render = /* @__PURE__ */ __name((...args) => {
    this.#renderer ??= (content) => this.html(content);
    return this.#renderer(...args);
  }, "render");
  setLayout = /* @__PURE__ */ __name((layout) => this.#layout = layout, "setLayout");
  getLayout = /* @__PURE__ */ __name(() => this.#layout, "getLayout");
  setRenderer = /* @__PURE__ */ __name((renderer) => {
    this.#renderer = renderer;
  }, "setRenderer");
  header = /* @__PURE__ */ __name((name, value, options) => {
    if (this.finalized) {
      this.#res = new Response(this.#res.body, this.#res);
    }
    const headers = this.#res ? this.#res.headers : this.#preparedHeaders ??= new Headers();
    if (value === void 0) {
      headers.delete(name);
    } else if (options?.append) {
      headers.append(name, value);
    } else {
      headers.set(name, value);
    }
  }, "header");
  status = /* @__PURE__ */ __name((status) => {
    this.#status = status;
  }, "status");
  set = /* @__PURE__ */ __name((key, value) => {
    this.#var ??= /* @__PURE__ */ new Map();
    this.#var.set(key, value);
  }, "set");
  get = /* @__PURE__ */ __name((key) => {
    return this.#var ? this.#var.get(key) : void 0;
  }, "get");
  get var() {
    if (!this.#var) {
      return {};
    }
    return Object.fromEntries(this.#var);
  }
  #newResponse(data, arg, headers) {
    const responseHeaders = this.#res ? new Headers(this.#res.headers) : this.#preparedHeaders ?? new Headers();
    if (typeof arg === "object" && "headers" in arg) {
      const argHeaders = arg.headers instanceof Headers ? arg.headers : new Headers(arg.headers);
      for (const [key, value] of argHeaders) {
        if (key.toLowerCase() === "set-cookie") {
          responseHeaders.append(key, value);
        } else {
          responseHeaders.set(key, value);
        }
      }
    }
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        if (typeof v === "string") {
          responseHeaders.set(k, v);
        } else {
          responseHeaders.delete(k);
          for (const v2 of v) {
            responseHeaders.append(k, v2);
          }
        }
      }
    }
    const status = typeof arg === "number" ? arg : arg?.status ?? this.#status;
    return new Response(data, { status, headers: responseHeaders });
  }
  newResponse = /* @__PURE__ */ __name((...args) => this.#newResponse(...args), "newResponse");
  body = /* @__PURE__ */ __name((data, arg, headers) => this.#newResponse(data, arg, headers), "body");
  text = /* @__PURE__ */ __name((text, arg, headers) => {
    return !this.#preparedHeaders && !this.#status && !arg && !headers && !this.finalized ? new Response(text) : this.#newResponse(
      text,
      arg,
      setDefaultContentType(TEXT_PLAIN, headers)
    );
  }, "text");
  json = /* @__PURE__ */ __name((object, arg, headers) => {
    return this.#newResponse(
      JSON.stringify(object),
      arg,
      setDefaultContentType("application/json", headers)
    );
  }, "json");
  html = /* @__PURE__ */ __name((html, arg, headers) => {
    const res = /* @__PURE__ */ __name((html2) => this.#newResponse(html2, arg, setDefaultContentType("text/html; charset=UTF-8", headers)), "res");
    return typeof html === "object" ? resolveCallback(html, HtmlEscapedCallbackPhase.Stringify, false, {}).then(res) : res(html);
  }, "html");
  redirect = /* @__PURE__ */ __name((location, status) => {
    const locationString = String(location);
    this.header(
      "Location",
      !/[^\x00-\xFF]/.test(locationString) ? locationString : encodeURI(locationString)
    );
    return this.newResponse(null, status ?? 302);
  }, "redirect");
  notFound = /* @__PURE__ */ __name(() => {
    this.#notFoundHandler ??= () => new Response();
    return this.#notFoundHandler(this);
  }, "notFound");
};

// node_modules/hono/dist/router.js
var METHOD_NAME_ALL = "ALL";
var METHOD_NAME_ALL_LOWERCASE = "all";
var METHODS = ["get", "post", "put", "delete", "options", "patch"];
var MESSAGE_MATCHER_IS_ALREADY_BUILT = "Can not add a route since the matcher is already built.";
var UnsupportedPathError = class extends Error {
  static {
    __name(this, "UnsupportedPathError");
  }
};

// node_modules/hono/dist/utils/constants.js
var COMPOSED_HANDLER = "__COMPOSED_HANDLER";

// node_modules/hono/dist/hono-base.js
var notFoundHandler = /* @__PURE__ */ __name((c) => {
  return c.text("404 Not Found", 404);
}, "notFoundHandler");
var errorHandler = /* @__PURE__ */ __name((err, c) => {
  if ("getResponse" in err) {
    const res = err.getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text("Internal Server Error", 500);
}, "errorHandler");
var Hono = class {
  static {
    __name(this, "Hono");
  }
  get;
  post;
  put;
  delete;
  options;
  patch;
  all;
  on;
  use;
  router;
  getPath;
  _basePath = "/";
  #path = "/";
  routes = [];
  constructor(options = {}) {
    const allMethods = [...METHODS, METHOD_NAME_ALL_LOWERCASE];
    allMethods.forEach((method) => {
      this[method] = (args1, ...args) => {
        if (typeof args1 === "string") {
          this.#path = args1;
        } else {
          this.#addRoute(method, this.#path, args1);
        }
        args.forEach((handler) => {
          this.#addRoute(method, this.#path, handler);
        });
        return this;
      };
    });
    this.on = (method, path, ...handlers) => {
      for (const p of [path].flat()) {
        this.#path = p;
        for (const m of [method].flat()) {
          handlers.map((handler) => {
            this.#addRoute(m.toUpperCase(), this.#path, handler);
          });
        }
      }
      return this;
    };
    this.use = (arg1, ...handlers) => {
      if (typeof arg1 === "string") {
        this.#path = arg1;
      } else {
        this.#path = "*";
        handlers.unshift(arg1);
      }
      handlers.forEach((handler) => {
        this.#addRoute(METHOD_NAME_ALL, this.#path, handler);
      });
      return this;
    };
    const { strict, ...optionsWithoutStrict } = options;
    Object.assign(this, optionsWithoutStrict);
    this.getPath = strict ?? true ? options.getPath ?? getPath : getPathNoStrict;
  }
  #clone() {
    const clone = new Hono({
      router: this.router,
      getPath: this.getPath
    });
    clone.errorHandler = this.errorHandler;
    clone.#notFoundHandler = this.#notFoundHandler;
    clone.routes = this.routes;
    return clone;
  }
  #notFoundHandler = notFoundHandler;
  errorHandler = errorHandler;
  route(path, app2) {
    const subApp = this.basePath(path);
    app2.routes.map((r) => {
      let handler;
      if (app2.errorHandler === errorHandler) {
        handler = r.handler;
      } else {
        handler = /* @__PURE__ */ __name(async (c, next) => (await compose([], app2.errorHandler)(c, () => r.handler(c, next))).res, "handler");
        handler[COMPOSED_HANDLER] = r.handler;
      }
      subApp.#addRoute(r.method, r.path, handler);
    });
    return this;
  }
  basePath(path) {
    const subApp = this.#clone();
    subApp._basePath = mergePath(this._basePath, path);
    return subApp;
  }
  onError = /* @__PURE__ */ __name((handler) => {
    this.errorHandler = handler;
    return this;
  }, "onError");
  notFound = /* @__PURE__ */ __name((handler) => {
    this.#notFoundHandler = handler;
    return this;
  }, "notFound");
  mount(path, applicationHandler, options) {
    let replaceRequest;
    let optionHandler;
    if (options) {
      if (typeof options === "function") {
        optionHandler = options;
      } else {
        optionHandler = options.optionHandler;
        if (options.replaceRequest === false) {
          replaceRequest = /* @__PURE__ */ __name((request) => request, "replaceRequest");
        } else {
          replaceRequest = options.replaceRequest;
        }
      }
    }
    const getOptions = optionHandler ? (c) => {
      const options2 = optionHandler(c);
      return Array.isArray(options2) ? options2 : [options2];
    } : (c) => {
      let executionContext = void 0;
      try {
        executionContext = c.executionCtx;
      } catch {
      }
      return [c.env, executionContext];
    };
    replaceRequest ||= (() => {
      const mergedPath = mergePath(this._basePath, path);
      const pathPrefixLength = mergedPath === "/" ? 0 : mergedPath.length;
      return (request) => {
        const url = new URL(request.url);
        url.pathname = url.pathname.slice(pathPrefixLength) || "/";
        return new Request(url, request);
      };
    })();
    const handler = /* @__PURE__ */ __name(async (c, next) => {
      const res = await applicationHandler(replaceRequest(c.req.raw), ...getOptions(c));
      if (res) {
        return res;
      }
      await next();
    }, "handler");
    this.#addRoute(METHOD_NAME_ALL, mergePath(path, "*"), handler);
    return this;
  }
  #addRoute(method, path, handler) {
    method = method.toUpperCase();
    path = mergePath(this._basePath, path);
    const r = { basePath: this._basePath, path, method, handler };
    this.router.add(method, path, [handler, r]);
    this.routes.push(r);
  }
  #handleError(err, c) {
    if (err instanceof Error) {
      return this.errorHandler(err, c);
    }
    throw err;
  }
  #dispatch(request, executionCtx, env, method) {
    if (method === "HEAD") {
      return (async () => new Response(null, await this.#dispatch(request, executionCtx, env, "GET")))();
    }
    const path = this.getPath(request, { env });
    const matchResult = this.router.match(method, path);
    const c = new Context(request, {
      path,
      matchResult,
      env,
      executionCtx,
      notFoundHandler: this.#notFoundHandler
    });
    if (matchResult[0].length === 1) {
      let res;
      try {
        res = matchResult[0][0][0][0](c, async () => {
          c.res = await this.#notFoundHandler(c);
        });
      } catch (err) {
        return this.#handleError(err, c);
      }
      return res instanceof Promise ? res.then(
        (resolved) => resolved || (c.finalized ? c.res : this.#notFoundHandler(c))
      ).catch((err) => this.#handleError(err, c)) : res ?? this.#notFoundHandler(c);
    }
    const composed = compose(matchResult[0], this.errorHandler, this.#notFoundHandler);
    return (async () => {
      try {
        const context = await composed(c);
        if (!context.finalized) {
          throw new Error(
            "Context is not finalized. Did you forget to return a Response object or `await next()`?"
          );
        }
        return context.res;
      } catch (err) {
        return this.#handleError(err, c);
      }
    })();
  }
  fetch = /* @__PURE__ */ __name((request, ...rest) => {
    return this.#dispatch(request, rest[1], rest[0], request.method);
  }, "fetch");
  request = /* @__PURE__ */ __name((input, requestInit, Env, executionCtx) => {
    if (input instanceof Request) {
      return this.fetch(requestInit ? new Request(input, requestInit) : input, Env, executionCtx);
    }
    input = input.toString();
    return this.fetch(
      new Request(
        /^https?:\/\//.test(input) ? input : `http://localhost${mergePath("/", input)}`,
        requestInit
      ),
      Env,
      executionCtx
    );
  }, "request");
  fire = /* @__PURE__ */ __name(() => {
    addEventListener("fetch", (event) => {
      event.respondWith(this.#dispatch(event.request, event, void 0, event.request.method));
    });
  }, "fire");
};

// node_modules/hono/dist/router/reg-exp-router/node.js
var LABEL_REG_EXP_STR = "[^/]+";
var ONLY_WILDCARD_REG_EXP_STR = ".*";
var TAIL_WILDCARD_REG_EXP_STR = "(?:|/.*)";
var PATH_ERROR = Symbol();
var regExpMetaChars = new Set(".\\+*[^]$()");
function compareKey(a, b) {
  if (a.length === 1) {
    return b.length === 1 ? a < b ? -1 : 1 : -1;
  }
  if (b.length === 1) {
    return 1;
  }
  if (a === ONLY_WILDCARD_REG_EXP_STR || a === TAIL_WILDCARD_REG_EXP_STR) {
    return 1;
  } else if (b === ONLY_WILDCARD_REG_EXP_STR || b === TAIL_WILDCARD_REG_EXP_STR) {
    return -1;
  }
  if (a === LABEL_REG_EXP_STR) {
    return 1;
  } else if (b === LABEL_REG_EXP_STR) {
    return -1;
  }
  return a.length === b.length ? a < b ? -1 : 1 : b.length - a.length;
}
__name(compareKey, "compareKey");
var Node = class {
  static {
    __name(this, "Node");
  }
  #index;
  #varIndex;
  #children = /* @__PURE__ */ Object.create(null);
  insert(tokens, index, paramMap, context, pathErrorCheckOnly) {
    if (tokens.length === 0) {
      if (this.#index !== void 0) {
        throw PATH_ERROR;
      }
      if (pathErrorCheckOnly) {
        return;
      }
      this.#index = index;
      return;
    }
    const [token, ...restTokens] = tokens;
    const pattern = token === "*" ? restTokens.length === 0 ? ["", "", ONLY_WILDCARD_REG_EXP_STR] : ["", "", LABEL_REG_EXP_STR] : token === "/*" ? ["", "", TAIL_WILDCARD_REG_EXP_STR] : token.match(/^\:([^\{\}]+)(?:\{(.+)\})?$/);
    let node;
    if (pattern) {
      const name = pattern[1];
      let regexpStr = pattern[2] || LABEL_REG_EXP_STR;
      if (name && pattern[2]) {
        if (regexpStr === ".*") {
          throw PATH_ERROR;
        }
        regexpStr = regexpStr.replace(/^\((?!\?:)(?=[^)]+\)$)/, "(?:");
        if (/\((?!\?:)/.test(regexpStr)) {
          throw PATH_ERROR;
        }
      }
      node = this.#children[regexpStr];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[regexpStr] = new Node();
        if (name !== "") {
          node.#varIndex = context.varIndex++;
        }
      }
      if (!pathErrorCheckOnly && name !== "") {
        paramMap.push([name, node.#varIndex]);
      }
    } else {
      node = this.#children[token];
      if (!node) {
        if (Object.keys(this.#children).some(
          (k) => k.length > 1 && k !== ONLY_WILDCARD_REG_EXP_STR && k !== TAIL_WILDCARD_REG_EXP_STR
        )) {
          throw PATH_ERROR;
        }
        if (pathErrorCheckOnly) {
          return;
        }
        node = this.#children[token] = new Node();
      }
    }
    node.insert(restTokens, index, paramMap, context, pathErrorCheckOnly);
  }
  buildRegExpStr() {
    const childKeys = Object.keys(this.#children).sort(compareKey);
    const strList = childKeys.map((k) => {
      const c = this.#children[k];
      return (typeof c.#varIndex === "number" ? `(${k})@${c.#varIndex}` : regExpMetaChars.has(k) ? `\\${k}` : k) + c.buildRegExpStr();
    });
    if (typeof this.#index === "number") {
      strList.unshift(`#${this.#index}`);
    }
    if (strList.length === 0) {
      return "";
    }
    if (strList.length === 1) {
      return strList[0];
    }
    return "(?:" + strList.join("|") + ")";
  }
};

// node_modules/hono/dist/router/reg-exp-router/trie.js
var Trie = class {
  static {
    __name(this, "Trie");
  }
  #context = { varIndex: 0 };
  #root = new Node();
  insert(path, index, pathErrorCheckOnly) {
    const paramAssoc = [];
    const groups = [];
    for (let i = 0; ; ) {
      let replaced = false;
      path = path.replace(/\{[^}]+\}/g, (m) => {
        const mark = `@\\${i}`;
        groups[i] = [mark, m];
        i++;
        replaced = true;
        return mark;
      });
      if (!replaced) {
        break;
      }
    }
    const tokens = path.match(/(?::[^\/]+)|(?:\/\*$)|./g) || [];
    for (let i = groups.length - 1; i >= 0; i--) {
      const [mark] = groups[i];
      for (let j = tokens.length - 1; j >= 0; j--) {
        if (tokens[j].indexOf(mark) !== -1) {
          tokens[j] = tokens[j].replace(mark, groups[i][1]);
          break;
        }
      }
    }
    this.#root.insert(tokens, index, paramAssoc, this.#context, pathErrorCheckOnly);
    return paramAssoc;
  }
  buildRegExp() {
    let regexp = this.#root.buildRegExpStr();
    if (regexp === "") {
      return [/^$/, [], []];
    }
    let captureIndex = 0;
    const indexReplacementMap = [];
    const paramReplacementMap = [];
    regexp = regexp.replace(/#(\d+)|@(\d+)|\.\*\$/g, (_, handlerIndex, paramIndex) => {
      if (handlerIndex !== void 0) {
        indexReplacementMap[++captureIndex] = Number(handlerIndex);
        return "$()";
      }
      if (paramIndex !== void 0) {
        paramReplacementMap[Number(paramIndex)] = ++captureIndex;
        return "";
      }
      return "";
    });
    return [new RegExp(`^${regexp}`), indexReplacementMap, paramReplacementMap];
  }
};

// node_modules/hono/dist/router/reg-exp-router/router.js
var emptyParam = [];
var nullMatcher = [/^$/, [], /* @__PURE__ */ Object.create(null)];
var wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
function buildWildcardRegExp(path) {
  return wildcardRegExpCache[path] ??= new RegExp(
    path === "*" ? "" : `^${path.replace(
      /\/\*$|([.\\+*[^\]$()])/g,
      (_, metaChar) => metaChar ? `\\${metaChar}` : "(?:|/.*)"
    )}$`
  );
}
__name(buildWildcardRegExp, "buildWildcardRegExp");
function clearWildcardRegExpCache() {
  wildcardRegExpCache = /* @__PURE__ */ Object.create(null);
}
__name(clearWildcardRegExpCache, "clearWildcardRegExpCache");
function buildMatcherFromPreprocessedRoutes(routes) {
  const trie = new Trie();
  const handlerData = [];
  if (routes.length === 0) {
    return nullMatcher;
  }
  const routesWithStaticPathFlag = routes.map(
    (route) => [!/\*|\/:/.test(route[0]), ...route]
  ).sort(
    ([isStaticA, pathA], [isStaticB, pathB]) => isStaticA ? 1 : isStaticB ? -1 : pathA.length - pathB.length
  );
  const staticMap = /* @__PURE__ */ Object.create(null);
  for (let i = 0, j = -1, len = routesWithStaticPathFlag.length; i < len; i++) {
    const [pathErrorCheckOnly, path, handlers] = routesWithStaticPathFlag[i];
    if (pathErrorCheckOnly) {
      staticMap[path] = [handlers.map(([h]) => [h, /* @__PURE__ */ Object.create(null)]), emptyParam];
    } else {
      j++;
    }
    let paramAssoc;
    try {
      paramAssoc = trie.insert(path, j, pathErrorCheckOnly);
    } catch (e) {
      throw e === PATH_ERROR ? new UnsupportedPathError(path) : e;
    }
    if (pathErrorCheckOnly) {
      continue;
    }
    handlerData[j] = handlers.map(([h, paramCount]) => {
      const paramIndexMap = /* @__PURE__ */ Object.create(null);
      paramCount -= 1;
      for (; paramCount >= 0; paramCount--) {
        const [key, value] = paramAssoc[paramCount];
        paramIndexMap[key] = value;
      }
      return [h, paramIndexMap];
    });
  }
  const [regexp, indexReplacementMap, paramReplacementMap] = trie.buildRegExp();
  for (let i = 0, len = handlerData.length; i < len; i++) {
    for (let j = 0, len2 = handlerData[i].length; j < len2; j++) {
      const map = handlerData[i][j]?.[1];
      if (!map) {
        continue;
      }
      const keys = Object.keys(map);
      for (let k = 0, len3 = keys.length; k < len3; k++) {
        map[keys[k]] = paramReplacementMap[map[keys[k]]];
      }
    }
  }
  const handlerMap = [];
  for (const i in indexReplacementMap) {
    handlerMap[i] = handlerData[indexReplacementMap[i]];
  }
  return [regexp, handlerMap, staticMap];
}
__name(buildMatcherFromPreprocessedRoutes, "buildMatcherFromPreprocessedRoutes");
function findMiddleware(middleware, path) {
  if (!middleware) {
    return void 0;
  }
  for (const k of Object.keys(middleware).sort((a, b) => b.length - a.length)) {
    if (buildWildcardRegExp(k).test(path)) {
      return [...middleware[k]];
    }
  }
  return void 0;
}
__name(findMiddleware, "findMiddleware");
var RegExpRouter = class {
  static {
    __name(this, "RegExpRouter");
  }
  name = "RegExpRouter";
  #middleware;
  #routes;
  constructor() {
    this.#middleware = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
    this.#routes = { [METHOD_NAME_ALL]: /* @__PURE__ */ Object.create(null) };
  }
  add(method, path, handler) {
    const middleware = this.#middleware;
    const routes = this.#routes;
    if (!middleware || !routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    if (!middleware[method]) {
      ;
      [middleware, routes].forEach((handlerMap) => {
        handlerMap[method] = /* @__PURE__ */ Object.create(null);
        Object.keys(handlerMap[METHOD_NAME_ALL]).forEach((p) => {
          handlerMap[method][p] = [...handlerMap[METHOD_NAME_ALL][p]];
        });
      });
    }
    if (path === "/*") {
      path = "*";
    }
    const paramCount = (path.match(/\/:/g) || []).length;
    if (/\*$/.test(path)) {
      const re = buildWildcardRegExp(path);
      if (method === METHOD_NAME_ALL) {
        Object.keys(middleware).forEach((m) => {
          middleware[m][path] ||= findMiddleware(middleware[m], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
        });
      } else {
        middleware[method][path] ||= findMiddleware(middleware[method], path) || findMiddleware(middleware[METHOD_NAME_ALL], path) || [];
      }
      Object.keys(middleware).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(middleware[m]).forEach((p) => {
            re.test(p) && middleware[m][p].push([handler, paramCount]);
          });
        }
      });
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          Object.keys(routes[m]).forEach(
            (p) => re.test(p) && routes[m][p].push([handler, paramCount])
          );
        }
      });
      return;
    }
    const paths = checkOptionalParameter(path) || [path];
    for (let i = 0, len = paths.length; i < len; i++) {
      const path2 = paths[i];
      Object.keys(routes).forEach((m) => {
        if (method === METHOD_NAME_ALL || method === m) {
          routes[m][path2] ||= [
            ...findMiddleware(middleware[m], path2) || findMiddleware(middleware[METHOD_NAME_ALL], path2) || []
          ];
          routes[m][path2].push([handler, paramCount - len + i + 1]);
        }
      });
    }
  }
  match(method, path) {
    clearWildcardRegExpCache();
    const matchers = this.#buildAllMatchers();
    this.match = (method2, path2) => {
      const matcher = matchers[method2] || matchers[METHOD_NAME_ALL];
      const staticMatch = matcher[2][path2];
      if (staticMatch) {
        return staticMatch;
      }
      const match = path2.match(matcher[0]);
      if (!match) {
        return [[], emptyParam];
      }
      const index = match.indexOf("", 1);
      return [matcher[1][index], match];
    };
    return this.match(method, path);
  }
  #buildAllMatchers() {
    const matchers = /* @__PURE__ */ Object.create(null);
    Object.keys(this.#routes).concat(Object.keys(this.#middleware)).forEach((method) => {
      matchers[method] ||= this.#buildMatcher(method);
    });
    this.#middleware = this.#routes = void 0;
    return matchers;
  }
  #buildMatcher(method) {
    const routes = [];
    let hasOwnRoute = method === METHOD_NAME_ALL;
    [this.#middleware, this.#routes].forEach((r) => {
      const ownRoute = r[method] ? Object.keys(r[method]).map((path) => [path, r[method][path]]) : [];
      if (ownRoute.length !== 0) {
        hasOwnRoute ||= true;
        routes.push(...ownRoute);
      } else if (method !== METHOD_NAME_ALL) {
        routes.push(
          ...Object.keys(r[METHOD_NAME_ALL]).map((path) => [path, r[METHOD_NAME_ALL][path]])
        );
      }
    });
    if (!hasOwnRoute) {
      return null;
    } else {
      return buildMatcherFromPreprocessedRoutes(routes);
    }
  }
};

// node_modules/hono/dist/router/smart-router/router.js
var SmartRouter = class {
  static {
    __name(this, "SmartRouter");
  }
  name = "SmartRouter";
  #routers = [];
  #routes = [];
  constructor(init) {
    this.#routers = init.routers;
  }
  add(method, path, handler) {
    if (!this.#routes) {
      throw new Error(MESSAGE_MATCHER_IS_ALREADY_BUILT);
    }
    this.#routes.push([method, path, handler]);
  }
  match(method, path) {
    if (!this.#routes) {
      throw new Error("Fatal error");
    }
    const routers = this.#routers;
    const routes = this.#routes;
    const len = routers.length;
    let i = 0;
    let res;
    for (; i < len; i++) {
      const router = routers[i];
      try {
        for (let i2 = 0, len2 = routes.length; i2 < len2; i2++) {
          router.add(...routes[i2]);
        }
        res = router.match(method, path);
      } catch (e) {
        if (e instanceof UnsupportedPathError) {
          continue;
        }
        throw e;
      }
      this.match = router.match.bind(router);
      this.#routers = [router];
      this.#routes = void 0;
      break;
    }
    if (i === len) {
      throw new Error("Fatal error");
    }
    this.name = `SmartRouter + ${this.activeRouter.name}`;
    return res;
  }
  get activeRouter() {
    if (this.#routes || this.#routers.length !== 1) {
      throw new Error("No active router has been determined yet.");
    }
    return this.#routers[0];
  }
};

// node_modules/hono/dist/router/trie-router/node.js
var emptyParams = /* @__PURE__ */ Object.create(null);
var Node2 = class {
  static {
    __name(this, "Node");
  }
  #methods;
  #children;
  #patterns;
  #order = 0;
  #params = emptyParams;
  constructor(method, handler, children) {
    this.#children = children || /* @__PURE__ */ Object.create(null);
    this.#methods = [];
    if (method && handler) {
      const m = /* @__PURE__ */ Object.create(null);
      m[method] = { handler, possibleKeys: [], score: 0 };
      this.#methods = [m];
    }
    this.#patterns = [];
  }
  insert(method, path, handler) {
    this.#order = ++this.#order;
    let curNode = this;
    const parts = splitRoutingPath(path);
    const possibleKeys = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const p = parts[i];
      const nextP = parts[i + 1];
      const pattern = getPattern(p, nextP);
      const key = Array.isArray(pattern) ? pattern[0] : p;
      if (key in curNode.#children) {
        curNode = curNode.#children[key];
        if (pattern) {
          possibleKeys.push(pattern[1]);
        }
        continue;
      }
      curNode.#children[key] = new Node2();
      if (pattern) {
        curNode.#patterns.push(pattern);
        possibleKeys.push(pattern[1]);
      }
      curNode = curNode.#children[key];
    }
    curNode.#methods.push({
      [method]: {
        handler,
        possibleKeys: possibleKeys.filter((v, i, a) => a.indexOf(v) === i),
        score: this.#order
      }
    });
    return curNode;
  }
  #getHandlerSets(node, method, nodeParams, params) {
    const handlerSets = [];
    for (let i = 0, len = node.#methods.length; i < len; i++) {
      const m = node.#methods[i];
      const handlerSet = m[method] || m[METHOD_NAME_ALL];
      const processedSet = {};
      if (handlerSet !== void 0) {
        handlerSet.params = /* @__PURE__ */ Object.create(null);
        handlerSets.push(handlerSet);
        if (nodeParams !== emptyParams || params && params !== emptyParams) {
          for (let i2 = 0, len2 = handlerSet.possibleKeys.length; i2 < len2; i2++) {
            const key = handlerSet.possibleKeys[i2];
            const processed = processedSet[handlerSet.score];
            handlerSet.params[key] = params?.[key] && !processed ? params[key] : nodeParams[key] ?? params?.[key];
            processedSet[handlerSet.score] = true;
          }
        }
      }
    }
    return handlerSets;
  }
  search(method, path) {
    const handlerSets = [];
    this.#params = emptyParams;
    const curNode = this;
    let curNodes = [curNode];
    const parts = splitPath(path);
    const curNodesQueue = [];
    for (let i = 0, len = parts.length; i < len; i++) {
      const part = parts[i];
      const isLast = i === len - 1;
      const tempNodes = [];
      for (let j = 0, len2 = curNodes.length; j < len2; j++) {
        const node = curNodes[j];
        const nextNode = node.#children[part];
        if (nextNode) {
          nextNode.#params = node.#params;
          if (isLast) {
            if (nextNode.#children["*"]) {
              handlerSets.push(
                ...this.#getHandlerSets(nextNode.#children["*"], method, node.#params)
              );
            }
            handlerSets.push(...this.#getHandlerSets(nextNode, method, node.#params));
          } else {
            tempNodes.push(nextNode);
          }
        }
        for (let k = 0, len3 = node.#patterns.length; k < len3; k++) {
          const pattern = node.#patterns[k];
          const params = node.#params === emptyParams ? {} : { ...node.#params };
          if (pattern === "*") {
            const astNode = node.#children["*"];
            if (astNode) {
              handlerSets.push(...this.#getHandlerSets(astNode, method, node.#params));
              astNode.#params = params;
              tempNodes.push(astNode);
            }
            continue;
          }
          const [key, name, matcher] = pattern;
          if (!part && !(matcher instanceof RegExp)) {
            continue;
          }
          const child = node.#children[key];
          const restPathString = parts.slice(i).join("/");
          if (matcher instanceof RegExp) {
            const m = matcher.exec(restPathString);
            if (m) {
              params[name] = m[0];
              handlerSets.push(...this.#getHandlerSets(child, method, node.#params, params));
              if (Object.keys(child.#children).length) {
                child.#params = params;
                const componentCount = m[0].match(/\//)?.length ?? 0;
                const targetCurNodes = curNodesQueue[componentCount] ||= [];
                targetCurNodes.push(child);
              }
              continue;
            }
          }
          if (matcher === true || matcher.test(part)) {
            params[name] = part;
            if (isLast) {
              handlerSets.push(...this.#getHandlerSets(child, method, params, node.#params));
              if (child.#children["*"]) {
                handlerSets.push(
                  ...this.#getHandlerSets(child.#children["*"], method, params, node.#params)
                );
              }
            } else {
              child.#params = params;
              tempNodes.push(child);
            }
          }
        }
      }
      curNodes = tempNodes.concat(curNodesQueue.shift() ?? []);
    }
    if (handlerSets.length > 1) {
      handlerSets.sort((a, b) => {
        return a.score - b.score;
      });
    }
    return [handlerSets.map(({ handler, params }) => [handler, params])];
  }
};

// node_modules/hono/dist/router/trie-router/router.js
var TrieRouter = class {
  static {
    __name(this, "TrieRouter");
  }
  name = "TrieRouter";
  #node;
  constructor() {
    this.#node = new Node2();
  }
  add(method, path, handler) {
    const results = checkOptionalParameter(path);
    if (results) {
      for (let i = 0, len = results.length; i < len; i++) {
        this.#node.insert(method, results[i], handler);
      }
      return;
    }
    this.#node.insert(method, path, handler);
  }
  match(method, path) {
    return this.#node.search(method, path);
  }
};

// node_modules/hono/dist/hono.js
var Hono2 = class extends Hono {
  static {
    __name(this, "Hono");
  }
  constructor(options = {}) {
    super(options);
    this.router = options.router ?? new SmartRouter({
      routers: [new RegExpRouter(), new TrieRouter()]
    });
  }
};

// node_modules/uuid/dist/esm-browser/rng.js
var getRandomValues;
var rnds8 = new Uint8Array(16);
function rng() {
  if (!getRandomValues) {
    getRandomValues = typeof crypto !== "undefined" && crypto.getRandomValues && crypto.getRandomValues.bind(crypto);
    if (!getRandomValues) {
      throw new Error("crypto.getRandomValues() not supported. See https://github.com/uuidjs/uuid#getrandomvalues-not-supported");
    }
  }
  return getRandomValues(rnds8);
}
__name(rng, "rng");

// node_modules/uuid/dist/esm-browser/stringify.js
var byteToHex = [];
for (let i = 0; i < 256; ++i) {
  byteToHex.push((i + 256).toString(16).slice(1));
}
function unsafeStringify(arr, offset = 0) {
  return byteToHex[arr[offset + 0]] + byteToHex[arr[offset + 1]] + byteToHex[arr[offset + 2]] + byteToHex[arr[offset + 3]] + "-" + byteToHex[arr[offset + 4]] + byteToHex[arr[offset + 5]] + "-" + byteToHex[arr[offset + 6]] + byteToHex[arr[offset + 7]] + "-" + byteToHex[arr[offset + 8]] + byteToHex[arr[offset + 9]] + "-" + byteToHex[arr[offset + 10]] + byteToHex[arr[offset + 11]] + byteToHex[arr[offset + 12]] + byteToHex[arr[offset + 13]] + byteToHex[arr[offset + 14]] + byteToHex[arr[offset + 15]];
}
__name(unsafeStringify, "unsafeStringify");

// node_modules/uuid/dist/esm-browser/native.js
var randomUUID = typeof crypto !== "undefined" && crypto.randomUUID && crypto.randomUUID.bind(crypto);
var native_default = {
  randomUUID
};

// node_modules/uuid/dist/esm-browser/v4.js
function v4(options, buf, offset) {
  if (native_default.randomUUID && !buf && !options) {
    return native_default.randomUUID();
  }
  options = options || {};
  const rnds = options.random || (options.rng || rng)();
  rnds[6] = rnds[6] & 15 | 64;
  rnds[8] = rnds[8] & 63 | 128;
  if (buf) {
    offset = offset || 0;
    for (let i = 0; i < 16; ++i) {
      buf[offset + i] = rnds[i];
    }
    return buf;
  }
  return unsafeStringify(rnds);
}
__name(v4, "v4");
var v4_default = v4;

// node_modules/hono/dist/utils/cookie.js
var validCookieNameRegEx = /^[\w!#$%&'*.^`|~+-]+$/;
var validCookieValueRegEx = /^[ !#-:<-[\]-~]*$/;
var parse = /* @__PURE__ */ __name((cookie, name) => {
  if (name && cookie.indexOf(name) === -1) {
    return {};
  }
  const pairs = cookie.trim().split(";");
  const parsedCookie = {};
  for (let pairStr of pairs) {
    pairStr = pairStr.trim();
    const valueStartPos = pairStr.indexOf("=");
    if (valueStartPos === -1) {
      continue;
    }
    const cookieName = pairStr.substring(0, valueStartPos).trim();
    if (name && name !== cookieName || !validCookieNameRegEx.test(cookieName)) {
      continue;
    }
    let cookieValue = pairStr.substring(valueStartPos + 1).trim();
    if (cookieValue.startsWith('"') && cookieValue.endsWith('"')) {
      cookieValue = cookieValue.slice(1, -1);
    }
    if (validCookieValueRegEx.test(cookieValue)) {
      parsedCookie[cookieName] = cookieValue.indexOf("%") !== -1 ? tryDecode(cookieValue, decodeURIComponent_) : cookieValue;
      if (name) {
        break;
      }
    }
  }
  return parsedCookie;
}, "parse");
var _serialize = /* @__PURE__ */ __name((name, value, opt = {}) => {
  let cookie = `${name}=${value}`;
  if (name.startsWith("__Secure-") && !opt.secure) {
    throw new Error("__Secure- Cookie must have Secure attributes");
  }
  if (name.startsWith("__Host-")) {
    if (!opt.secure) {
      throw new Error("__Host- Cookie must have Secure attributes");
    }
    if (opt.path !== "/") {
      throw new Error('__Host- Cookie must have Path attributes with "/"');
    }
    if (opt.domain) {
      throw new Error("__Host- Cookie must not have Domain attributes");
    }
  }
  if (opt && typeof opt.maxAge === "number" && opt.maxAge >= 0) {
    if (opt.maxAge > 3456e4) {
      throw new Error(
        "Cookies Max-Age SHOULD NOT be greater than 400 days (34560000 seconds) in duration."
      );
    }
    cookie += `; Max-Age=${opt.maxAge | 0}`;
  }
  if (opt.domain && opt.prefix !== "host") {
    cookie += `; Domain=${opt.domain}`;
  }
  if (opt.path) {
    cookie += `; Path=${opt.path}`;
  }
  if (opt.expires) {
    if (opt.expires.getTime() - Date.now() > 3456e7) {
      throw new Error(
        "Cookies Expires SHOULD NOT be greater than 400 days (34560000 seconds) in the future."
      );
    }
    cookie += `; Expires=${opt.expires.toUTCString()}`;
  }
  if (opt.httpOnly) {
    cookie += "; HttpOnly";
  }
  if (opt.secure) {
    cookie += "; Secure";
  }
  if (opt.sameSite) {
    cookie += `; SameSite=${opt.sameSite.charAt(0).toUpperCase() + opt.sameSite.slice(1)}`;
  }
  if (opt.priority) {
    cookie += `; Priority=${opt.priority.charAt(0).toUpperCase() + opt.priority.slice(1)}`;
  }
  if (opt.partitioned) {
    if (!opt.secure) {
      throw new Error("Partitioned Cookie must have Secure attributes");
    }
    cookie += "; Partitioned";
  }
  return cookie;
}, "_serialize");
var serialize = /* @__PURE__ */ __name((name, value, opt) => {
  value = encodeURIComponent(value);
  return _serialize(name, value, opt);
}, "serialize");

// node_modules/hono/dist/helper/cookie/index.js
var getCookie = /* @__PURE__ */ __name((c, key, prefix) => {
  const cookie = c.req.raw.headers.get("Cookie");
  if (typeof key === "string") {
    if (!cookie) {
      return void 0;
    }
    let finalKey = key;
    if (prefix === "secure") {
      finalKey = "__Secure-" + key;
    } else if (prefix === "host") {
      finalKey = "__Host-" + key;
    }
    const obj2 = parse(cookie, finalKey);
    return obj2[finalKey];
  }
  if (!cookie) {
    return {};
  }
  const obj = parse(cookie);
  return obj;
}, "getCookie");
var generateCookie = /* @__PURE__ */ __name((name, value, opt) => {
  let cookie;
  if (opt?.prefix === "secure") {
    cookie = serialize("__Secure-" + name, value, { path: "/", ...opt, secure: true });
  } else if (opt?.prefix === "host") {
    cookie = serialize("__Host-" + name, value, {
      ...opt,
      path: "/",
      secure: true,
      domain: void 0
    });
  } else {
    cookie = serialize(name, value, { path: "/", ...opt });
  }
  return cookie;
}, "generateCookie");
var setCookie = /* @__PURE__ */ __name((c, name, value, opt) => {
  const cookie = generateCookie(name, value, opt);
  c.header("Set-Cookie", cookie, { append: true });
}, "setCookie");
var deleteCookie = /* @__PURE__ */ __name((c, name, opt) => {
  const deletedCookie = getCookie(c, name, opt?.prefix);
  setCookie(c, name, "", { ...opt, maxAge: 0 });
  return deletedCookie;
}, "deleteCookie");

// src/auth.ts
var SESSION_COOKIE = "sid";
var SESSION_TTL = 60 * 60 * 24 * 7;
var PBKDF2_HASH = "SHA-256";
var PBKDF2_ITERATIONS = 1e5;
var PBKDF2_KEYLEN = 32;
var SALT_BYTES = 16;
function b64e(u8) {
  let s = "";
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
__name(b64e, "b64e");
function b64d(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
__name(b64d, "b64d");
async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: PBKDF2_HASH, salt, iterations },
    key,
    PBKDF2_KEYLEN * 8
  );
  return new Uint8Array(bits);
}
__name(pbkdf2, "pbkdf2");
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const dk = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:sha256:${PBKDF2_ITERATIONS}:${b64e(salt)}:${b64e(dk)}`;
}
__name(hashPassword, "hashPassword");
async function verifyPassword(password, stored) {
  const [alg, hash, iterStr, saltB64, dkB64] = stored.split(":");
  if (alg !== "pbkdf2" || hash !== "sha256") return false;
  const iterations = parseInt(iterStr, 10);
  if (!Number.isFinite(iterations) || iterations > 1e5) return false;
  const salt = b64d(saltB64);
  const expected = b64d(dkB64);
  const got = await pbkdf2(password, salt, iterations);
  if (got.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got[i] ^ expected[i];
  return diff === 0;
}
__name(verifyPassword, "verifyPassword");
async function createSession(env, userId) {
  const token = crypto.randomUUID();
  await env.APP_KV.put(`sess:${token}`, userId, { expirationTtl: SESSION_TTL });
  return token;
}
__name(createSession, "createSession");
async function readSession(env, token) {
  if (!token) return null;
  const uid = await env.APP_KV.get(`sess:${token}`);
  return uid ?? null;
}
__name(readSession, "readSession");
async function destroySession(env, token) {
  if (!token) return;
  await env.APP_KV.delete(`sess:${token}`);
}
__name(destroySession, "destroySession");
var withCors = /* @__PURE__ */ __name(async (c, next) => {
  const origin = c.req.header("Origin") ?? "*";
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Credentials": "true",
        "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Admin-Token"
      }
    });
  }
  await next();
  c.res.headers.set("Access-Control-Allow-Origin", origin);
  c.res.headers.set("Access-Control-Allow-Credentials", "true");
}, "withCors");
async function mustUser(c, next) {
  const sid = getCookie(c, SESSION_COOKIE);
  const uid = await readSession(c.env, sid);
  if (!uid) return c.text("Unauthorized", 401);
  c.get = (k) => k === "userId" ? uid : void 0;
  await next();
}
__name(mustUser, "mustUser");
var auth = new Hono2();
auth.post("/register", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) return c.text("Invalid payload", 400);
  const e = await c.env.APP_DB.prepare(
    "SELECT id FROM users WHERE email=?1"
  ).bind(email).first();
  if (e) return c.text("Email already exists", 409);
  const id = crypto.randomUUID();
  const pw_hash = await hashPassword(password);
  const now = Date.now();
  await c.env.APP_DB.prepare(
    "INSERT INTO users (id,email,pw_hash,role,created_at) VALUES (?1,?2,?3,?4,?5)"
  ).bind(id, email, pw_hash, "user", now).run();
  await c.env.APP_DB.prepare(
    "INSERT INTO point_accounts (id,user_id,balance,updated_at) VALUES (?1,?2,?3,?4)"
  ).bind(crypto.randomUUID(), id, 0, now).run();
  const token = await createSession(c.env, id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    secure: true,
    domain: ".dataruapp.com",
    maxAge: SESSION_TTL
  });
  return c.json({ ok: true, user: { id, email } });
});
auth.post("/login", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!email || !password) return c.text("Invalid email or password", 401);
  const u = await c.env.APP_DB.prepare(
    "SELECT id, pw_hash FROM users WHERE email=?1"
  ).bind(email).first();
  if (!u) return c.text("Invalid email or password", 401);
  const ok = await verifyPassword(password, u.pw_hash);
  if (!ok) return c.text("Invalid email or password", 401);
  const token = await createSession(c.env, u.id);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    // 必須搭配 SameSite=None
    sameSite: "None",
    // 允許跨站（從 localhost:3000 到 api.dataruapp.com）
    path: "/",
    domain: ".dataruapp.com",
    maxAge: SESSION_TTL
  });
  return c.json({ ok: true, user: { id: u.id, email } });
});
auth.post("/logout", async (c) => {
  const sid = getCookie(c, SESSION_COOKIE);
  await destroySession(c.env, sid);
  deleteCookie(c, SESSION_COOKIE, {
    path: "/",
    domain: ".dataruapp.com",
    secure: true,
    sameSite: "None"
  });
  return c.json({ ok: true });
});
auth.get("/me", mustUser, async (c) => {
  const userId = c.get("userId");
  const u = await c.env.APP_DB.prepare(
    "SELECT id,email,role,created_at FROM users WHERE id=?1"
  ).bind(userId).first();
  if (!u) return c.text("User not found", 404);
  const acc = await c.env.APP_DB.prepare(
    "SELECT balance FROM point_accounts WHERE user_id=?1"
  ).bind(userId).first();
  return c.json({
    ok: true,
    user: u,
    balance: acc?.balance ?? 0
  });
});

// src/me_links.ts
function randCode4() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}
__name(randCode4, "randCode4");
async function uniqueCode(c) {
  for (let i = 0; i < 50; i++) {
    const code = randCode4();
    const hit = await c.env.APP_DB.prepare("SELECT id FROM links WHERE code=?").bind(code).first();
    if (!hit) return code;
  }
  throw new Error("code generation failed");
}
__name(uniqueCode, "uniqueCode");
async function sha256Hex(file) {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex, "sha256Hex");
async function putToR2(c, key, file) {
  const stream = file.stream();
  await c.env.R2_BUCKET.put(key, stream, {
    httpMetadata: { contentType: file.type || "application/octet-stream" }
  });
}
__name(putToR2, "putToR2");
function installMeLinks(app2) {
  app2.post("/me/links", mustUser, async (c) => {
    const userId = c.get("userId");
    const form = await c.req.formData();
    const title = form.get("title") ?? "";
    const version = form.get("version") ?? "";
    const bundle_id = form.get("bundle_id") ?? "";
    const lang = form.get("lang") ?? "en";
    const cn_direct = form.get("cn_direct") === "1" ? 1 : 0;
    const apk = form.get("apk");
    const ipa = form.get("ipa");
    if (!apk && !ipa) return c.text("\u81F3\u5C11\u4E0A\u50B3\u4E00\u500B\u6A94\u6848", 400);
    const code = form.get("code") || await uniqueCode(c);
    const now = Date.now();
    const ins = await c.env.APP_DB.prepare(
      "INSERT INTO links (id, code, title, is_active, cn_direct, created_at, owner_id, lang) VALUES (uuid(), ?, ?, 1, ?, ?, ?, ?)"
    ).bind(code, title, cn_direct, now, userId, lang).run();
    if (!ins.success) return c.text("Create link failed", 500);
    const linkRow = await c.env.APP_DB.prepare("SELECT id FROM links WHERE code=?").bind(code).first();
    if (!linkRow) return c.text("link not found after create", 500);
    const linkId = linkRow.id;
    const uploadedKeys = [];
    const handleOne = /* @__PURE__ */ __name(async (file, platform) => {
      const sha = await sha256Hex(file);
      const key = `dist/${userId}/${linkId}/${platform}/${file.name}`;
      await putToR2(c, key, file);
      uploadedKeys.push(key);
      const size = file.size;
      await c.env.APP_DB.prepare(
        "INSERT INTO files (id, owner_id, link_id, platform, package_name, version, size, r2_key, sha256, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(userId, linkId, platform, bundle_id, version, size, key, sha, now).run();
    }, "handleOne");
    try {
      if (apk) await handleOne(apk, "apk");
      if (ipa) await handleOne(ipa, "ipa");
    } catch (e) {
      for (const k of uploadedKeys) await c.env.R2_BUCKET.delete(k);
      await c.env.APP_DB.prepare("DELETE FROM files WHERE link_id=?").bind(linkId).run();
      await c.env.APP_DB.prepare("DELETE FROM links WHERE id=?").bind(linkId).run();
      return c.text(`Upload failed: ${e.message}`, 500);
    }
    return c.json({ ok: true, link: { id: linkId, code, title, cn_direct, lang } });
  });
  app2.delete("/me/links/:id", mustUser, async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const link = await c.env.APP_DB.prepare("SELECT id FROM links WHERE id=? AND owner_id=?").bind(id, userId).first();
    if (!link) return c.text("Not found", 404);
    const files = await c.env.APP_DB.prepare("SELECT r2_key FROM files WHERE link_id=?").bind(id).all();
    for (const f of files.results ?? []) {
      if (f.r2_key) await c.env.R2_BUCKET.delete(f.r2_key);
    }
    await c.env.APP_DB.prepare("DELETE FROM files WHERE link_id=?").bind(id).run();
    await c.env.APP_DB.prepare("DELETE FROM links WHERE id=?").bind(id).run();
    return c.json({ ok: true });
  });
  app2.patch("/me/links/:id/files", mustUser, async (c) => {
    const userId = c.get("userId");
    const id = c.req.param("id");
    const form = await c.req.formData();
    const apk = form.get("apk");
    const ipa = form.get("ipa");
    const link = await c.env.APP_DB.prepare("SELECT id FROM links WHERE id=? AND owner_id=?").bind(id, userId).first();
    if (!link) return c.text("Not found", 404);
    const now = Date.now();
    const replaceOne = /* @__PURE__ */ __name(async (file, platform) => {
      const old = await c.env.APP_DB.prepare("SELECT id, r2_key FROM files WHERE link_id=? AND platform=?").bind(id, platform).first();
      if (old?.r2_key) await c.env.R2_BUCKET.delete(old.r2_key);
      if (old?.id) await c.env.APP_DB.prepare("DELETE FROM files WHERE id=?").bind(old.id).run();
      const sha = await sha256Hex(file);
      const key = `dist/${userId}/${id}/${platform}/${file.name}`;
      await putToR2(c, key, file);
      const size = file.size;
      await c.env.APP_DB.prepare(
        "INSERT INTO files (id, owner_id, link_id, platform, package_name, version, size, r2_key, sha256, created_at) VALUES (uuid(), ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).bind(userId, id, platform, "", "", size, key, sha, now).run();
    }, "replaceOne");
    if (!apk && !ipa) return c.text("no file", 400);
    if (apk) await replaceOne(apk, "apk");
    if (ipa) await replaceOne(ipa, "ipa");
    return c.json({ ok: true });
  });
}
__name(installMeLinks, "installMeLinks");

// src/index.ts
var app = new Hono2();
installMeLinks(app);
app.use("*", withCors);
app.get("/health", (c) => c.json({ ok: true, ts: Date.now() }));
app.use("/admin/*", async (c, next) => {
  const token = c.req.header("x-admin-token");
  if (!token || token !== c.env.ADMIN_TOKEN) return c.text("Unauthorized", 401);
  await next();
});
async function readJSON(c) {
  try {
    return await c.req.json();
  } catch {
    c.status(400);
    throw new Error("Invalid JSON body");
  }
}
__name(readJSON, "readJSON");
app.post("/admin/users", async (c) => {
  const { email, initialBalance = 0 } = await readJSON(c);
  if (!email) return c.text("email required", 400);
  const id = crypto.randomUUID();
  const now = Date.now();
  const db = c.env.APP_DB;
  await db.prepare("INSERT INTO users (id, email, pw_hash, role, created_at) VALUES (?1, ?2, '', 'user', ?3)").bind(id, email, now).run();
  await db.prepare("INSERT INTO point_accounts (id, user_id, balance, updated_at) VALUES (?1, ?2, ?3, ?4)").bind(id, id, initialBalance, now).run();
  if (initialBalance > 0) {
    await db.prepare(
      "INSERT INTO point_ledger (id, account_id, delta, reason, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
    ).bind(crypto.randomUUID(), id, initialBalance, "init credit", now).run();
  }
  return c.json({ id, email, balance: initialBalance, created_at: now });
});
app.post("/admin/recharge", async (c) => {
  const { userId, packageId } = await readJSON(c);
  if (!userId || !packageId) return c.text("userId & packageId required", 400);
  const pkg = {
    P1: { points: 500, usd: 1 },
    P2: { points: 3e3, usd: 5 },
    P3: { points: 2e4, usd: 15 },
    P5: { points: 5e4, usd: 35 },
    P6: { points: 15e4, usd: 100 },
    P7: { points: 5e5, usd: 300 }
  };
  const sel = pkg[packageId];
  if (!sel) return c.text("invalid packageId", 400);
  const db = c.env.APP_DB;
  const now = Date.now();
  const acc = await db.prepare("SELECT balance FROM point_accounts WHERE id=?1").bind(userId).first();
  if (!acc) return c.text("User/Account Not Found", 404);
  const newBal = (acc.balance || 0) + sel.points;
  await db.batch([
    db.prepare("UPDATE point_accounts SET balance=?, updated_at=? WHERE id=?").bind(newBal, now, userId),
    db.prepare(
      "INSERT INTO point_ledger (id, account_id, delta, reason, created_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(crypto.randomUUID(), userId, sel.points, `recharge ${packageId}`, now)
  ]);
  return c.json({ ok: true, balance: newBal });
});
app.post("/admin/files", async (c) => {
  const body = await readJSON(c);
  if (!body.ownerId || !body.platform || !body.package_name || !body.version || !body.r2_key) {
    return c.text("ownerId/platform/package_name/version/r2_key required", 400);
  }
  const acc = await c.env.APP_DB.prepare("SELECT 1 FROM point_accounts WHERE id=?1").bind(body.ownerId).first();
  if (!acc) return c.text("ownerId not found", 400);
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.APP_DB.prepare(
    `INSERT INTO files (id, owner_id, platform, package_name, channel, version, size, sha256, r2_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
  ).bind(
    id,
    body.ownerId,
    body.platform,
    body.package_name,
    body.channel ?? null,
    body.version,
    body.size ?? null,
    body.sha256 ?? null,
    body.r2_key,
    now
  ).run();
  return c.json({ id });
});
app.post("/admin/links", async (c) => {
  const body = await readJSON(c);
  if (!body.fileId || !body.code) return c.text("fileId & code required", 400);
  const dup = await c.env.APP_DB.prepare("SELECT 1 FROM links WHERE code=?1").bind(body.code).first();
  if (dup) {
    c.status(409);
    return c.text("code already exists");
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  await c.env.APP_DB.prepare(
    `INSERT INTO links (id, code, title, file_id, is_active, cn_direct, created_at)
       VALUES (?1, ?2, ?3, ?4, 1, ?5, ?6)`
  ).bind(id, body.code, body.title ?? "", body.fileId, body.cn_direct ? 1 : 0, now).run();
  return c.json({ id, code: body.code });
});
app.get("/admin/users", async (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const like = `%${q}%`;
  const { results } = await c.env.APP_DB.prepare(
    `SELECT u.id, u.email, pa.balance, u.created_at
       FROM users u
       LEFT JOIN point_accounts pa ON pa.id = u.id
       WHERE u.email LIKE ?1
       ORDER BY u.created_at DESC
       LIMIT ?2 OFFSET ?3`
  ).bind(like, limit, offset).all();
  return c.json({
    items: results,
    nextOffset: results.length === limit ? offset + limit : null
  });
});
app.get("/admin/files", async (c) => {
  const url = new URL(c.req.url);
  const ownerId = url.searchParams.get("ownerId");
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const like = `%${q}%`;
  let sql = `
    SELECT id, owner_id, platform, package_name, channel, version, size, sha256, r2_key, created_at
    FROM files
    WHERE 1=1
  `;
  const binds = [];
  if (ownerId) {
    sql += ` AND owner_id = ?`;
    binds.push(ownerId);
  }
  if (q) {
    sql += ` AND (package_name LIKE ? OR version LIKE ? OR r2_key LIKE ?)`;
    binds.push(like, like, like);
  }
  sql += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  binds.push(limit, offset);
  const { results } = await c.env.APP_DB.prepare(sql).bind(...binds).all();
  return c.json({
    items: results,
    nextOffset: results.length === limit ? offset + limit : null
  });
});
app.get("/admin/links", async (c) => {
  const url = new URL(c.req.url);
  const q = url.searchParams.get("q") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0", 10);
  const like = `%${q}%`;
  const { results } = await c.env.APP_DB.prepare(
    `SELECT id, code, title, file_id, is_active, cn_direct, created_at
       FROM links
       WHERE (code LIKE ?1 OR title LIKE ?1)
       ORDER BY created_at DESC
       LIMIT ?2 OFFSET ?3`
  ).bind(like, limit, offset).all();
  return c.json({
    items: results,
    nextOffset: results.length === limit ? offset + limit : null
  });
});
app.patch("/admin/files/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJSON(c);
  const fields = [];
  const binds = [];
  if (body.ownerId) {
    const ok = await c.env.APP_DB.prepare("SELECT 1 FROM point_accounts WHERE id=?1").bind(body.ownerId).first();
    if (!ok) return c.text("ownerId not found", 400);
    fields.push("owner_id=?");
    binds.push(body.ownerId);
  }
  if (typeof body.r2_key === "string") {
    fields.push("r2_key=?");
    binds.push(body.r2_key);
  }
  if (typeof body.package_name === "string") {
    fields.push("package_name=?");
    binds.push(body.package_name);
  }
  if (typeof body.channel === "string" || body.channel === null) {
    fields.push("channel=?");
    binds.push(body.channel);
  }
  if (typeof body.version === "string") {
    fields.push("version=?");
    binds.push(body.version);
  }
  if (Number.isFinite(body.size)) {
    fields.push("size=?");
    binds.push(Number(body.size));
  }
  if (typeof body.sha256 === "string" || body.sha256 === null) {
    fields.push("sha256=?");
    binds.push(body.sha256);
  }
  if (!fields.length) return c.text("no fields", 400);
  await c.env.APP_DB.prepare(`UPDATE files SET ${fields.join(", ")} WHERE id=?`).bind(...binds, id).run();
  const row = await c.env.APP_DB.prepare(
    "SELECT id, owner_id, platform, package_name, channel, version, size, sha256, r2_key, created_at FROM files WHERE id=?1"
  ).bind(id).first();
  return c.json(row);
});
app.patch("/admin/links/:id", async (c) => {
  const id = c.req.param("id");
  const body = await readJSON(c);
  const fields = [];
  const binds = [];
  if (typeof body.title === "string") {
    fields.push("title=?");
    binds.push(body.title);
  }
  if (typeof body.is_active !== "undefined") {
    fields.push("is_active=?");
    binds.push(body.is_active ? 1 : 0);
  }
  if (typeof body.cn_direct !== "undefined") {
    fields.push("cn_direct=?");
    binds.push(body.cn_direct ? 1 : 0);
  }
  if (typeof body.code === "string") {
    fields.push("code=?");
    binds.push(body.code);
  }
  if (typeof body.fileId === "string") {
    fields.push("file_id=?");
    binds.push(body.fileId);
  }
  if (!fields.length) return c.text("no fields", 400);
  try {
    await c.env.APP_DB.prepare(`UPDATE links SET ${fields.join(", ")} WHERE id=?`).bind(...binds, id).run();
  } catch (e) {
    if (String(e?.message || "").includes("UNIQUE")) {
      c.status(409);
      return c.text("code already exists");
    }
    throw e;
  }
  const row = await c.env.APP_DB.prepare("SELECT id, code, title, file_id, is_active, cn_direct, created_at FROM links WHERE id=?1").bind(id).first();
  return c.json(row);
});
app.delete("/admin/links/:id", async (c) => {
  const id = c.req.param("id");
  const res = await c.env.APP_DB.prepare("DELETE FROM links WHERE id=?1").bind(id).run();
  const changes = res?.meta?.changes ?? res?.changes ?? 0;
  return c.json({ ok: true, changes });
});
app.delete("/admin/files/:id", async (c) => {
  const id = c.req.param("id");
  const cnt = await c.env.APP_DB.prepare("SELECT COUNT(1) AS n FROM links WHERE file_id=?1").bind(id).first();
  const n = cnt?.n ?? 0;
  if (n > 0) {
    c.status(409);
    return c.text("has_links");
  }
  const res = await c.env.APP_DB.prepare("DELETE FROM files WHERE id=?1").bind(id).run();
  const changes = res?.meta?.changes ?? res?.changes ?? 0;
  return c.json({ ok: true, changes });
});
app.get("/me/links", mustUser, async (c) => {
  const userId = c.get("userId");
  const limit = Number(c.req.query("limit") ?? 20);
  const offset = Number(c.req.query("offset") ?? 0);
  const rows = await c.env.APP_DB.prepare(
    `SELECT l.id, l.code, l.title, l.is_active, l.created_at,
            f.id as file_id, f.platform, f.package_name, f.version, f.size
       FROM links l
       JOIN files f ON f.id = l.file_id
      WHERE f.owner_id = ?
      ORDER BY l.created_at DESC
      LIMIT ? OFFSET ?`
  ).bind(userId, limit, offset).all();
  return c.json({ ok: true, items: rows.results ?? [] });
});
app.get("/me/files", mustUser, async (c) => {
  const userId = c.get("userId");
  const limit = Number(c.req.query("limit") ?? "100");
  const rs = await c.env.APP_DB.prepare(
    `SELECT id, owner_id, platform, package_name, version, size, r2_key, sha256, created_at
       FROM files WHERE owner_id=? ORDER BY created_at DESC LIMIT ?`
  ).bind(userId, limit).all();
  return c.json({ ok: true, files: rs.results ?? [] });
});
function encodeRfc3986(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
__name(encodeRfc3986, "encodeRfc3986");
function pathEncode(key) {
  return key.split("/").map(encodeRfc3986).join("/");
}
__name(pathEncode, "pathEncode");
async function sha256Hex2(input) {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(sha256Hex2, "sha256Hex");
async function importKeyRaw(rawKey) {
  return crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
__name(importKeyRaw, "importKeyRaw");
async function hmacKey(key, data) {
  const k = await importKeyRaw(key);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}
__name(hmacKey, "hmacKey");
async function getSigningKey(secret, date, region, service) {
  const kDate = await hmacKey(new TextEncoder().encode("AWS4" + secret), date);
  const kRegion = await hmacKey(kDate, region);
  const kServ = await hmacKey(kRegion, service);
  const kSig = await hmacKey(kServ, "aws4_request");
  return await importKeyRaw(kSig);
}
__name(getSigningKey, "getSigningKey");
async function hmacHex(key, data) {
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
__name(hmacHex, "hmacHex");
function amzDateNow() {
  const d = /* @__PURE__ */ new Date();
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  const ss = String(d.getUTCSeconds()).padStart(2, "0");
  const datestamp = `${yyyy}${mm}${dd}`;
  const amzDate = `${datestamp}T${hh}${mi}${ss}Z`;
  return { datestamp, amzDate };
}
__name(amzDateNow, "amzDateNow");
async function signR2PutUrl(env, key, expiresSec = 3600) {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const bucket = env.R2_BUCKET_NAME;
  const { datestamp, amzDate } = amzDateNow();
  const algorithm = "AWS4-HMAC-SHA256";
  const credential = `${env.R2_ACCESS_KEY_ID}/${datestamp}/auto/s3/aws4_request`;
  const signedHeaders = "host";
  const qs = new URLSearchParams({
    "X-Amz-Algorithm": algorithm,
    "X-Amz-Credential": credential,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": signedHeaders
  });
  const canonicalQuery = qs.toString();
  const path = `/${bucket}/${pathEncode(key)}`;
  const canonicalRequest = `PUT
${path}
${canonicalQuery}
host:${host}

${signedHeaders}
UNSIGNED-PAYLOAD`;
  const crHash = await sha256Hex2(canonicalRequest);
  const stringToSign = `${algorithm}
${amzDate}
${datestamp}/auto/s3/aws4_request
${crHash}`;
  const k = await getSigningKey(env.R2_SECRET_ACCESS_KEY, datestamp, "auto", "s3");
  const signature = await hmacHex(k, stringToSign);
  const url = `https://${host}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  return url;
}
__name(signR2PutUrl, "signR2PutUrl");
app.post("/me/upload-temp", mustUser, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  if (body.platform !== "apk" && body.platform !== "ipa") return c.text("platform must be apk or ipa", 400);
  if (!body.filename) return c.text("filename required", 400);
  const safeName = body.filename.replace(/[^\w.\-]+/g, "_");
  const tmpKey = `tmp/${userId}/${crypto.randomUUID()}-${safeName}`;
  const putUrl = await signR2PutUrl(c.env, tmpKey, 300);
  return c.json({ ok: true, putUrl, key: tmpKey, expires: 300 });
});
app.post("/me/upload-abort", mustUser, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  if (!body.key || !body.key.startsWith(`tmp/${userId}/`)) return c.text("bad key", 400);
  await c.env.R2_BUCKET.delete(body.key).catch(() => {
  });
  return c.json({ ok: true });
});
app.post("/me/commit-files", mustUser, async (c) => {
  const userId = c.get("userId");
  const now = Date.now();
  const body = await c.req.json().catch(() => ({}));
  async function promote(kind, x) {
    if (!x?.key) return null;
    if (!x.key.startsWith(`tmp/${userId}/`)) throw new Error("bad key");
    const fileName = x.key.split("/").pop();
    const finalKey = `apps/${x.package_name}/${x.version}/${fileName}`;
    if (typeof c.env.R2_BUCKET.copy === "function") {
      await c.env.R2_BUCKET.copy(x.key, finalKey);
    } else {
      const obj = await c.env.R2_BUCKET.get(x.key);
      if (!obj) throw new Error("tmp object missing");
      await c.env.R2_BUCKET.put(finalKey, obj.body, { httpMetadata: obj.httpMetadata });
    }
    await c.env.R2_BUCKET.delete(x.key);
    const head = await c.env.R2_BUCKET.head(finalKey);
    const size = head?.size ?? 0;
    const id = crypto.randomUUID();
    await c.env.APP_DB.prepare(
      `INSERT INTO files (id, owner_id, platform, package_name, version, size, r2_key, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
    ).bind(id, userId, kind, x.package_name, x.version, size, finalKey, now).run();
    return { id, r2_key: finalKey, size };
  }
  __name(promote, "promote");
  const apk = await promote("apk", body.apk ?? void 0);
  const ios = await promote("ipa", body.ios ?? void 0);
  if (!apk && !ios) return c.text("nothing to commit", 400);
  return c.json({ ok: true, apk, ios });
});
function randomCode4() {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.random() * chars.length | 0];
  return s;
}
__name(randomCode4, "randomCode4");
app.post("/me/links", mustUser, async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json().catch(() => ({}));
  const title = (body.title ?? "").trim();
  const cnDirect = body.cn_direct ? 1 : 0;
  const locale = (body.locale || "en").trim();
  const now2 = Date.now();
  const getFile = /* @__PURE__ */ __name(async (id) => await c.env.APP_DB.prepare("SELECT id, owner_id, platform FROM files WHERE id=?1").bind(id).first() || null, "getFile");
  let apkFile = null;
  let iosFile = null;
  if (body.apk?.file_id) {
    const f = await getFile(body.apk.file_id);
    if (!f) return c.text("apk file not found", 404);
    if (f.owner_id !== userId) return c.text("apk file not owned by user", 403);
    if (f.platform !== "apk") return c.text("apk file_id is not an APK", 400);
    apkFile = f;
  }
  if (body.ios?.file_id) {
    const f = await getFile(body.ios.file_id);
    if (!f) return c.text("ios file not found", 404);
    if (f.owner_id !== userId) return c.text("ios file not owned by user", 403);
    if (f.platform !== "ipa") return c.text("ios file_id is not an IPA", 400);
    iosFile = f;
  }
  if (!apkFile && !iosFile) return c.text("no file selected", 400);
  let code = body.code && /^[a-zA-Z]{4}$/.test(body.code) ? body.code : randomCode4();
  for (let i = 0; i < 5; i++) {
    const exists = await c.env.APP_DB.prepare("SELECT 1 FROM links WHERE code=?1 LIMIT 1").bind(code).first();
    if (!exists) break;
    code = randomCode4();
    if (i === 4) return c.text("code collision, please retry", 409);
  }
  const linksCreated = [];
  const insertLink = /* @__PURE__ */ __name(async (fileId, platform) => {
    const id = v4_default();
    await c.env.APP_DB.prepare(
      `INSERT INTO links (id, code, file_id, title, is_active, created_at, cn_direct)
         VALUES (?,?,?,?, 1, ?, ?)`
    ).bind(id, code, fileId, title, now2, cnDirect).run();
    linksCreated.push({ id, platform });
  }, "insertLink");
  if (apkFile) await insertLink(apkFile.id, "apk");
  if (iosFile) await insertLink(iosFile.id, "ipa");
  await c.env.APP_KV.put(`link_lang:${code}`, locale);
  return c.json({ ok: true, code, links: linksCreated });
});
app.route("/auth", auth);
var index_default = app;
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
