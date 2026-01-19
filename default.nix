{ pkgs ? import <nixpkgs> {} }:

let
  python = pkgs.python3;
  
  # Helper to build Python packages from PyPI
  buildPypiPackage = { pname, version, sha256, buildInputs ? [], propagatedBuildInputs ? [] }:
    python.pkgs.buildPythonPackage rec {
      inherit pname version;
      src = pkgs.fetchurl {
        url = "https://files.pythonhosted.org/packages/source/${builtins.substring 0 1 pname}/${pname}/${pname}-${version}.tar.gz";
        inherit sha256;
      };
      pyproject = true;
      nativeBuildInputs = buildInputs;
      inherit propagatedBuildInputs;
      doCheck = false; # Skip tests for simplicity and speed
    };

  httpx-sse = buildPypiPackage {
    pname = "httpx_sse";
    version = "0.4.3";
    sha256 = "9b1ed0127459a66014aec3c56bebd93da3c1bc8bb6618c8082039a44889a755d";
    buildInputs = [ python.pkgs.setuptools python.pkgs.setuptools-scm ];
    propagatedBuildInputs = [ python.pkgs.httpx ];
  };

  sse-starlette = buildPypiPackage {
    pname = "sse_starlette";
    version = "3.2.0";
    sha256 = "8127594edfb51abe44eac9c49e59b0b01f1039d0c7461c6fd91d4e03b70da422";
    buildInputs = [ python.pkgs.setuptools ];
    propagatedBuildInputs = [ python.pkgs.starlette python.pkgs.anyio ];
  };

  mcp = buildPypiPackage {
    pname = "mcp";
    version = "1.25.0";
    sha256 = "56310361ebf0364e2d438e5b45f7668cbb124e158bb358333cd06e49e83a6802";
    buildInputs = [ python.pkgs.hatchling python.pkgs.uv-dynamic-versioning ];
    propagatedBuildInputs = with python.pkgs; [
      anyio
      httpx
      jsonschema
      pydantic
      pydantic-settings
      pyjwt
      python-multipart
      starlette
      typing-extensions
      typing-inspection
      uvicorn
    ] ++ [ httpx-sse sse-starlette ];
  };

in python.pkgs.buildPythonApplication {
  pname = "dice-roller-mcp";
  version = "0.1.0";
  format = "pyproject";

  src = ./.;

  nativeBuildInputs = [
    pkgs.pkg-config
    pkgs.gobject-introspection
    pkgs.wrapGAppsHook3
    python.pkgs.hatchling
  ];

  propagatedBuildInputs = [
    python.pkgs.pygobject3
    mcp
    pkgs.gtk3
    pkgs.cairo
  ];
}
