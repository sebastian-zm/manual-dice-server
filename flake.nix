{
  description = "Dice Roller MCP Server";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        package = import ./default.nix { inherit pkgs; };
      in
      {
        packages.default = package;
        
        apps.default = {
          type = "app";
          program = "${package}/bin/dice-roller-mcp";
        };

        devShells.default = import ./shell.nix { inherit pkgs; };
      }
    );
}
