let
  moz_overlay = import (builtins.fetchTarball https://github.com/mozilla/nixpkgs-mozilla/archive/master.tar.gz);
  # Pin to stable from https://status.nixos.org/
  nixpkgs = import (fetchTarball "https://github.com/NixOS/nixpkgs/archive/219951b495fc2eac67b1456824cc1ec1fd2ee659.tar.gz") { overlays = [ moz_overlay ]; };
in
  with nixpkgs;
  stdenv.mkDerivation {
    name = "moz_overlay_shell";
    buildInputs = with nixpkgs; [
      ((rustChannelOf{ channel = "1.79"; }).rust.override {
        extensions = ["rust-src"];
        targets = ["wasm32-unknown-unknown"];
      })
      cargo-watch
      nodejs
      wasm-pack
    ];
  }
