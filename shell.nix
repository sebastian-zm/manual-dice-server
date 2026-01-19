{ pkgs ? import <nixpkgs> {} }:

let
  drv = import ./default.nix { inherit pkgs; };
in pkgs.mkShell {
  inputsFrom = [ drv ];
  packages = [ drv pkgs.gobject-introspection pkgs.gtk3 ];
  shellHook = ''
    export PYTHONPATH=$PYTHONPATH:$(pwd)
    echo "Environment ready. Run 'dice-roller-mcp' or 'python3 dice_roller_server.py' to start."
  '';
}
