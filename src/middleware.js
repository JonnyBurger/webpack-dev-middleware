import path from "path";

import mime from "mime-types";

import getFilenameFromUrl from "./utils/getFilenameFromUrl";
import handleRangeHeaders from "./utils/handleRangeHeaders";
import ready from "./utils/ready";

export default function wrapper(context) {
  return async function middleware(req, res, next) {
    const acceptedMethods = context.options.methods || ["GET", "HEAD"];

    // fixes #282. credit @cexoso. in certain edge situations res.locals is undefined.
    // eslint-disable-next-line no-param-reassign
    res.locals = res.locals || {};

    if (!acceptedMethods.includes(req.method)) {
      await goNext();
      return;
    }

    ready(context, processRequest, req);

    async function goNext() {
      if (!context.options.serverSideRender) {
        return next();
      }

      return new Promise((resolve) => {
        ready(
          context,
          () => {
            // eslint-disable-next-line no-param-reassign
            res.locals.webpack = { devMiddleware: context };

            resolve(next());
          },
          req
        );
      });
    }

    async function processRequest() {
      const filename = getFilenameFromUrl(context, req.url);
      let { headers } = context.options;

      if (typeof headers === "function") {
        headers = headers(req, res, context);
      }

      let fileSize;

      if (!filename) {
        await goNext();
        return;
      }

      try {
        fileSize = context.outputFileSystem.lstatSync(filename).size;
      } catch (_ignoreError) {
        await goNext();
        return;
      }

      const contentTypeHeader = res.get
        ? res.get("Content-Type")
        : res.getHeader("Content-Type");

      if (!contentTypeHeader) {
        // content-type name(like application/javascript; charset=utf-8) or false
        const contentType = mime.contentType(path.extname(filename));

        // Only set content-type header if media type is known
        // https://tools.ietf.org/html/rfc7231#section-3.1.1.5
        if (contentType) {
          // Express API
          if (res.set) {
            res.set("Content-Type", contentType);
          }
          // Node.js API
          else {
            res.setHeader("Content-Type", contentType);
          }
        }
      }

      if (headers) {
        const names = Object.keys(headers);

        for (const name of names) {
          // Express API
          if (res.set) {
            res.set(name, headers[name]);
          }
          // Node.js API
          else {
            res.setHeader(name, headers[name]);
          }
        }
      }

      // Buffer
      const ranges = handleRangeHeaders(context, fileSize, req, res);
      const stream = context.outputFileSystem.createReadStream(
        filename,
        ranges
          ? {
              start: ranges.start,
              end: ranges.end,
            }
          : {}
      );

      const responseSize = ranges ? 1 + (ranges.end - ranges.start) : fileSize;
      res.setHeader("Content-Length", responseSize);

      if (req.method === "HEAD") {
        res.end();
      } else {
        stream.pipe(res);
      }
    }
  };
}
