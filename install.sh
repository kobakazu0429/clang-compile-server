# wasi-sdk
apt update
apt install -y wget

pushd /opt

wget --no-check-certificate https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-12/wasi-sdk-12.0-linux.tar.gz
tar xvzf wasi-sdk-12.0-linux.tar.gz

# wasm-opt
wget https://github.com/WebAssembly/binaryen/releases/download/version_101/binaryen-version_101-x86_64-linux.tar.gz
tar xvzf binaryen-version_101-x86_64-linux.tar.gz

popd

pnpm install
pnpm run build
pnpm run start --clang=/opt/wasi-sdk-12.0 --wasm-opt=/opt/binaryen-version_101/bin/wasm-opt --port 3000
