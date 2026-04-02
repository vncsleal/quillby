; Quillby Windows Installer (NSIS)
; Builds a single quillby-windows.exe that installs the binary and writes Claude Desktop config

!include "MUI2.nsh"

Name "Quillby"
OutFile "quillby-windows.exe"
InstallDir "$LOCALAPPDATA\Quillby"
RequestExecutionLevel user
SetCompressor lzma

!define MUI_ABORTWARNING
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath "$INSTDIR"
  File "quillby-mcp-windows-x64.exe"
  Rename "$INSTDIR\quillby-mcp-windows-x64.exe" "$INSTDIR\quillby-mcp.exe"

  ; Write Claude Desktop config via PowerShell (no external dependencies)
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -Command \
    "$config = @{}; \
     $configFile = \"$env:APPDATA\Claude\claude_desktop_config.json\"; \
     if (Test-Path $configFile) { try { $config = Get-Content $configFile -Raw | ConvertFrom-Json -AsHashtable } catch {} }; \
     if (-not $config.ContainsKey(\"mcpServers\")) { $config[\"mcpServers\"] = @{} }; \
     $config[\"mcpServers\"][\"quillby\"] = @{ command = \"$INSTDIR\quillby-mcp.exe\" }; \
     New-Item -ItemType Directory -Force -Path \"$env:APPDATA\Claude\" | Out-Null; \
     $config | ConvertTo-Json -Depth 10 | Set-Content -Path $configFile -Encoding UTF8"'
SectionEnd
