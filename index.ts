import fastify from "fastify";
import { ulid } from "ulid";
import path from "node:path";
import fs from "node:fs/promises";
import cluster from "node:cluster";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify, parseArgs } from "node:util";

// const CLANG_PATH = process.env.WASI_SDK;
// const WASM_OPT_PATH = process.env.WASM_OPT;

// if (!CLANG_PATH) throw new Error("CLANG_PATH not set");
// if (!WASM_OPT_PATH) throw new Error("WASM_OPT_PATH not set");

const args = parseArgs({
  options: {
    clang: {
      type: "string",
    },
    "wasm-opt": {
      type: "string",
    },
    port: {
      type: "string",
      short: "p",
    },
    workers: {
      type: "string",
      short: "w",
    },
  },
});

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception: ", err.toString());
  if (err.stack) {
    console.error(err.stack);
  }
});

const pExec = promisify(execFile);

const port = parseInt(args.values.port ?? "8080", 10);
const logging = true;
const server = fastify({
  logger: true,
});

server.get("/ping", async (request, reply) => {
  reply.send("pong");
});

const fib = (n: number): number => {
  if (n === 0) {
    return 0;
  } else if (n === 1) {
    return 1;
  } else {
    return fib(n - 1) + fib(n - 2);
  }
};

server.get<{ Querystring: { num: number } }>("/fib", async (request, reply) => {
  const { num } = request.query;
  // console.log(num);
  reply.send(fib(num));
});

const CODE = {
  OK: 0,
  ERROR: 10,
  UNKNOWN: 90,
};

server.post<{ Body: { src: string } }>("/compile", async (request, reply) => {
  const { src } = request.body;
  try {
    const binary = await compileToWasm(src).catch((e) => {
      throw e;
    });
    reply.send({
      code: CODE.OK,
      binary,
    });
  } catch (error: any) {
    console.log(error);
    const message = error.stderr
      .trim()
      .replaceAll(
        "/Users/kazu/ghq/github.com/kobakazu0429/wasm-c-web-server/.tmp/",
        ""
      )
      .replaceAll(/[0-9A-Z]{26}\.c/g, "main.c");

    console.log(message);

    reply.send({
      code: CODE.ERROR,
      message,
    });
  }
});

const tmpDir = os.tmpdir();

const compileToWasm = async (src: string) => {
  const id = ulid();
  const rawFileName = `${id}.c`;
  const wasmFileName = `${id}.wasm`;
  const asyncWasmFileName = `${id}.async.wasm`;

  // const dirname = path.dirname(url.fileURLToPath(import.meta.url));
  const tmp = path.join(tmpDir, "wasm-c-web-complie-server");

  const rawFilePath = path.resolve(path.join(tmp, rawFileName));
  const wasmFilePath = path.resolve(path.join(tmp, wasmFileName));
  const asyncWasmFilePath = path.resolve(path.join(tmp, asyncWasmFileName));

  await fs.writeFile(rawFilePath, src);

  const CLANG_PATH = args.values.clang ?? "";
  await pExec(
    [
      `${CLANG_PATH}/bin/clang`,
      `--sysroot=${CLANG_PATH}/share/wasi-sysroot`,

      // The file size is generally 1.3 to almost 2 times larger.
      "-Wl,--export-all",
      rawFilePath,
      `-o`,
      wasmFilePath,
    ].join(" ")
  );

  const WASM_OPT_PATH = args.values["wasm-opt"] ?? "";
  await pExec(
    `${WASM_OPT_PATH} --asyncify ${wasmFilePath} -o ${asyncWasmFilePath}`
  );

  return fs.readFile(asyncWasmFilePath);
};

const main = async () => {
  // const CPUS = parseInt(args.values.workers,10) ?? os.cpus().length;
  const CPUS = 4;
  const master = () => {
    console.log("Total Number of Cores: %o", CPUS);
    console.log("Master %o is running", process.pid);

    for (let i = 0; i < CPUS; i++) {
      const fork = cluster.fork();
      fork.send(i);
    }

    cluster.on("online", (worker) => {
      console.log("Worker %o is listening", worker.process.pid);
    });

    cluster.on("exit", (worker) => {
      console.log("Worker %o died", worker.process.pid);
    });
  };

  const worker = () => {
    const cb = (index: number) => {
      // Unregister immediately current listener for message
      process.off("message", cb);

      // Run application
      console.log("Worker %o started", process.pid);

      server.listen({ port }, (err, address) => {
        if (err) {
          console.error(err);
          process.exit(1);
        }
        if (!logging) {
          console.log(`Server listening at ${address}`);
        }
        console.log("🚀 Server ready at %s on worker %o", address, index);
      });
    };

    process.on("message", cb);
  };

  if (cluster.isPrimary) {
    master();
  } else {
    worker();
  }
};

main();
