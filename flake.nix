{
  description = "Build a development environment for sandy image";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    crane.url = "github:ipetkov/crane";

    flake-utils.url = "github:numtide/flake-utils";

    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, crane, flake-utils, rust-overlay, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ (import rust-overlay) ];
        };

        inherit (pkgs) lib;

        # Configure Rust with WebAssembly target support
        rustToolchainFor = p: p.rust-bin.stable.latest.default.override {
          # Set the build targets supported by the toolchain,
          targets = [ "wasm32-unknown-unknown" ];
        };
        craneLib = (crane.mkLib pkgs).overrideToolchain rustToolchainFor;
        src = craneLib.cleanCargoSource ./.;

        # Common arguments can be set here to avoid repeating them later
        # Note: changes here will rebuild all dependency crates
        commonArgs = {
          inherit src;
          strictDeps = true;

          buildInputs = [
            # Add additional build inputs here
          ];

          # Makes sure we are building for the WASM target
          CARGO_BUILD_TARGET = "wasm32-unknown-unknown";
        };

        cargoArtifacts = craneLib.buildDepsOnly commonArgs;

        wasm-binary = craneLib.buildPackage (commonArgs // {
          inherit cargoArtifacts;

          description = "Build sandy-image WASM binary";

          cargoExtraArgs = "--lib";

          # Can't test wasm output
          doCheck = false;
        });

        # Helper script to build with specific options and output to a directory
        # Build process has two main steps:
        # 1. Compile Rust to wasm using cargo (wasm-binary)
        # 2. Generate JS bindings from the wasm (sandy-image)
        buildScript = pkgs.writeShellScriptBin "sandy-build" ''
          #!/usr/bin/env bash
          set -e

          # Parse arguments
          RELEASE=true
          OUT_DIR="."

          while [[ $# -gt 0 ]]; do
            case $1 in
              --dev)
                RELEASE=false
                shift
                ;;
              --out-dir)
                OUT_DIR="$2"
                shift 2
                ;;
              *)
                echo "Unknown option: $1"
                exit 1
                ;;
            esac
          done

          # Build with appropriate settings
          if [[ "$RELEASE" == "true" ]]; then
            echo "Building in release mode..."
            ${pkgs.wasm-bindgen-cli}/bin/wasm-bindgen --target no-modules --no-typescript --out-name sandy-image \
              --out-dir "$OUT_DIR" ${wasm-binary}/lib/sandy_image.wasm

            # Optimize the wasm binary in release mode
            ${pkgs.binaryen}/bin/wasm-opt -O "$OUT_DIR/sandy-image_bg.wasm" -o "$OUT_DIR/sandy-image_bg.wasm"
          else
            echo "Building in development mode..."
            ${pkgs.wasm-bindgen-cli}/bin/wasm-bindgen --target no-modules --no-typescript --out-name sandy-image \
              --out-dir "$OUT_DIR" --debug ${wasm-binary}/lib/sandy_image.wasm
          fi

          # Copy other required files
          echo "Copying additional files..."
          cp $PWD/sandy.js $PWD/sandy-worker.js "$OUT_DIR/"
          cp $PWD/index.html "$OUT_DIR/"
          cp $PWD/README.md $PWD/package.json "$OUT_DIR/"

          echo "Build complete in $OUT_DIR"
        '';


        sandy-image = pkgs.stdenv.mkDerivation {
          name = "sandy-image";
          src = ./.;

          buildInputs = with pkgs; [
            binaryen
            wasm-bindgen-cli
            buildScript
          ];

          buildPhase = ''
            # Use the shared build script for release mode
            mkdir -p $out
            sandy-build --out-dir $out
          '';
        };

        # Create a development server that uses the same build script
        dev-server = pkgs.writeShellScriptBin "sandy-dev-server" ''
          #!/usr/bin/env bash
          set -e

          # Make a temporary directory to serve files from
          TMP_DIR=$(mktemp -d)
          trap "rm -rf $TMP_DIR" EXIT

          # Initial build using the shared build script
          echo "🦀 Building Sandy Image in dev mode..."
          ${buildScript}/bin/sandy-build --dev --out-dir "$TMP_DIR"

          # Start HTTP server in the background
          echo "🌐 Starting HTTP server at http://localhost:8080"
          ${pkgs.nodePackages.http-server}/bin/http-server "$TMP_DIR" -c-1 &
          SERVER_PID=$!
          trap "kill $SERVER_PID; rm -rf $TMP_DIR" EXIT

          echo "👀 Watching for changes..."
          ${pkgs.cargo-watch}/bin/cargo-watch -w src -w Cargo.toml -s "sandy-build --dev --out-dir '$TMP_DIR'"
        '';
      in
      {
        checks = {
          # The WebAssembly binary is a crucial build artifact
          inherit wasm-binary;

          # Run clippy (and deny all warnings) on the crate source,
          # again, reusing the dependency artifacts from above.
          #
          # Note that this is done as a separate derivation so that
          # we can block the CI if there are issues here, but not
          # prevent downstream consumers from building our crate by itself.
          clippy = craneLib.cargoClippy (commonArgs // {
            inherit cargoArtifacts;
            cargoClippyExtraArgs = "--all-targets -- --deny warnings";
            description = "Run clippy";
          });

          # Check formatting
          fmt = craneLib.cargoFmt {
            inherit src;
            description = "Check code formatting";
          };
        };

        packages.default = sandy-image;

        apps = {
          default = flake-utils.lib.mkApp {
            drv = dev-server;
          };
        };

        devShells.default = let
          # Create check scripts for each check in self.checks.${system}
          checkScripts = lib.mapAttrs (name: _:
            pkgs.writeShellScriptBin "check-${name}" ''
              nix build .#checks.${system}.${name} "$@"
            ''
          ) self.checks.${system};
        in  craneLib.devShell {
          # Inherit inputs from checks.
          checks = self.checks.${system};

          # Shell hooks to create executable scripts in a local bin directory
          shellHook = ''
            col_width=20;
            cargo_version=$(cargo --version 2>/dev/null)

            echo -e "\033[1;36m=== 🦀 Welcome to the Sandy Image development environment ===\033[0m"
            echo -e "\033[1;33m• $cargo_version\033[0m"
            echo ""
            echo -e "\033[1;33mAvailable commands:\033[0m"
            ${builtins.concatStringsSep "\n" (
              lib.mapAttrsToList (name: def: ''
                printf "  \033[1;37m%-''${col_width}s\033[0m - %s\n" "check-${name}" "${def.description}"
              '') self.checks.${system}
            )}
            printf "  \033[1;37m%-''${col_width}s\033[0m - %s\n" "nix flake check" "Run all checks"
            printf "  \033[1;37m%-''${col_width}s\033[0m - %s\n" "nix build" "Build the sandy image JS bindgens"
            printf "  \033[1;37m%-''${col_width}s\033[0m - %s\n" "nix run" "Start a dev server"
            echo ""

            echo -e "\n\033[1;33m• Checking for any outdated packages...\033[0m\n"
            cargo outdated --root-deps-only
          '';

          # Extra inputs can be added here; cargo and rustc are provided by default.
          packages = with pkgs; [
            rust-analyzer
            cargo-watch
            cargo-outdated
          ] ++ lib.attrValues checkScripts;
        };
      });
}
