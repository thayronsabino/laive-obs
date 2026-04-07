# Release Process - LAIVE OBS

## 1. Estrategia
- Desenvolvimento e validacao local.
- Build e publicacao oficial via GitHub Actions.
- Release cross-platform por tag `v*`.

## 1.1 O Manifesto de Distribuição (Por que usamos CI/CD do GitHub?)

A lógica por trás de usar o GitHub (via **GitHub Actions** / CI-CD) para "processar" as compilações, em vez de fazer tudo apenas no computador local, resolve um dos maiores pesadelos no desenvolvimento de aplicativos Standalone/Desktop: **a distribuição multiplataforma.**

Aqui estão as 3 razões principais da nossa arquitetura utilizar o GitHub para isso:

### 1. A Regra do "Compilar no Sistema Operativo Certo"
Prometemos que seríamos cross-platform: temos instaladores para **Windows (`.exe`)**, **macOS (`.dmg`)** e **Linux (`.deb`)**. 
Porém, para empacotar e compilar arquivos do ecossistema macOS (principalmente lidar com assinaturas de código da Apple), você *precisa* rodar isso num computador Mac. Ao utilizar o GitHub Actions, empurramos o código para o repositório e o GitHub nos dá "computadores na nuvem". Ele levanta uma máquina Windows, um Mac e uma máquina Linux simultaneamente, compila as três versões do LAIVE OBS de uma só vez e nos devolve os instaladores prontos.

### 2. Automação de Versões (Zero Trabalho Manual)
Toda vez que corrigimos um bug ou lançamos um recurso novo, não precisamos ficar rodando scripts longos manualmente em cada plataforma, zipando pastas e jogando num Drive. A lógica de usar o GitHub obriga que a automação libere nativamente. O momento que dizemos "Lance a versão 1.0.5", a pipeline constrói os executáveis e cria sozinha a página pública de **Releases** aninhando os arquivos. 

### 3. Transparência Corporativa (Auditoria)
Como adotamos o modelo "Source Available" (Código Fonte Disponível), grandes produtoras e igrejas olham para executáveis de terceiros com desconfiança (temendo malwares ou mineração de dados). Ao deixar o GitHub processar abertamente a compilação numa "Pipeline", a empresa pode atestar passo-a-passo como o código aberto se tornou aquele instalador invisível que ela está rodando no ambiente crítico de transmissão dela. Isso transmite extrema maturidade executiva ("Nós não temos nada a esconder no build").

Resumindo: Desenvolvemos e testamos no **localhost**, mas na hora decisiva de "Lançar para o público", passamos o bastão de arquitetura de compilação para nuvem.


## 2. Workflow oficial
- Arquivo: `.github/workflows/release-cross-platform.yml`
- Trigger automatico: `git push origin vX.Y.Z[-alpha|-beta|-rc]`
- Trigger manual: `workflow_dispatch` com input `tag`.
- Script auxiliar para disparo manual: `scripts/dispatch-release-cross-platform.ps1`.
- Gate de integridade no CI:
  - Windows: `scripts/verify-windows-alpha.ps1 -IncludeExternal`
  - macOS/Linux: `scripts/verify-unix-alpha.sh --include-external`
  - a publicacao so ocorre apos as verificacoes passarem em todas as plataformas.
- Gate formal de paridade no CI:
  - arquivo obrigatorio: `docs/RELEASE_PARITY_CHECKLIST.json`
  - verificador: `scripts/verify-parity-release-gate.mjs`
  - sem checklist valido para a tag da release, o workflow falha antes dos builds.

## 3. Artefatos publicados
- Windows:
  - `laive-obs-windows-alpha.zip`
  - `laive-obs-windows-alpha-installer.exe`
  - `laive-obs-windows-alpha-installer.msi`
  - `checksums.sha256`
  - `build-metadata.json`
  - `installer-metadata.json`
  - `msi-metadata.json`
- macOS:
  - `laive-obs-macos-alpha.dmg`
  - `checksums.sha256`
  - `build-metadata.json`
  - `macos-notarization-metadata.json`
- Linux:
  - `laive-obs-linux-alpha.deb`
  - `laive-obs-linux-alpha.AppImage`
  - `checksums.sha256`
  - `build-metadata.json`
  - `appimage-metadata.json`

## 4. Assinatura opcional no CI (Windows)
Segredos suportados:
- `LAIVE_SIGN_CERT_PFX_BASE64`: certificado PFX em Base64.
- `LAIVE_SIGN_CERT_PASSWORD`: senha do PFX.
- `LAIVE_SIGN_CERT_SHA1`: thumbprint (alternativa ao PFX).
- `LAIVE_SIGN_TIMESTAMP_URL`: servidor de timestamp (opcional).
- `LAIVE_REQUIRE_SIGNED_WINDOWS`: `true/1` para falhar release sem assinatura valida do instalador.
- `LAIVE_ENABLE_WINDOWS_ZIP_SIGNING`: `1` para tentar assinatura do `.zip` (opcional e nao recomendado por padrao).
- `LAIVE_MACOS_SIGN_IDENTITY`: identidade de assinatura macOS (Developer ID Application).
- `LAIVE_MACOS_NOTARY_PROFILE`: perfil salvo no keychain para `xcrun notarytool`.
- `LAIVE_ENABLE_MACOS_NOTARIZATION`: `1` para solicitar assinatura/notarizacao quando segredos estiverem presentes.
- `LAIVE_REQUIRE_NOTARIZED_MACOS`: `true/1` para falhar release sem notarizacao valida.

Preflight no workflow:
- se `LAIVE_REQUIRE_SIGNED_WINDOWS` estiver ativo e nenhum segredo de material (`LAIVE_SIGN_CERT_PFX_BASE64` ou `LAIVE_SIGN_CERT_SHA1`) estiver configurado, o job Windows falha antes do build.
- se `LAIVE_REQUIRE_NOTARIZED_MACOS` estiver ativo e faltar `LAIVE_MACOS_SIGN_IDENTITY` ou `LAIVE_MACOS_NOTARY_PROFILE`, o job macOS falha antes do build.

Com assinatura configurada:
- `LAIVE_WINDOWS_INSTALLER_SIGN_SCRIPT` e injetado automaticamente no workflow.
- `LAIVE_WINDOWS_SIGN_SCRIPT` so e injetado se `LAIVE_ENABLE_WINDOWS_ZIP_SIGNING=1`.
- O pipeline tenta assinar instalador Windows por padrao.
- O metadata registra status de assinatura e verificacao.
- Se `LAIVE_SIGN_TIMESTAMP_URL` nao for definido, o fluxo usa `https://timestamp.digicert.com` por padrao.
- O script de assinatura nao imprime argumentos sensiveis (ex.: senha do PFX) no log.
- Script auxiliar para configurar secrets:
  - `scripts/setup-release-secrets.ps1`
  - Exemplo:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/setup-release-secrets.ps1 `
  -Repository "ORG/REPO" `
  -PfxPath "C:\secure\laive-signing.pfx" `
  -PfxPassword "SENHA" `
  -RequireSignedWindows
```

## 4.1 Disparo de release por tag (manual)
```powershell
powershell -ExecutionPolicy Bypass -File scripts/dispatch-release-cross-platform.ps1 `
  -Repository "ORG/REPO" `
  -Tag "v0.1.0-alpha"
```

## 4.2 Build remoto focado em instaladores Windows (recomendado)
- Workflow dedicado: `.github/workflows/windows-installers-ci.yml`
- Objetivo: gerar `.zip`, `.exe` e `.msi` no runner Windows do GitHub (evitando depender do ambiente local para Inno/WiX).
- Disparo por script:
```powershell
powershell -ExecutionPolicy Bypass -File scripts/dispatch-windows-installers-ci.ps1 `
  -Repository "ORG/REPO" `
  -Ref "main" `
  -Wait
```
- Opcoes de seguranca:
  - `-RequireSignedWindows`: exige assinatura valida (falha se secrets de assinatura nao estiverem configurados).
  - `-EnableZipSigning`: habilita assinatura opcional do `.zip`.

## 5. Gate minimo recomendado
- `npm run test`
- `npm run test:e2e`
- `npm run ffmpeg:healthcheck`
- `npm run quality:local`
- atualizar `docs/RELEASE_PARITY_CHECKLIST.json` com:
  - `releaseTag` igual a tag da release;
  - `approvedBy` e `approvedAtUtc`;
  - todos os itens do `checklist` em `true`;
  - `parityMatrixStatus = "closed"` para release estavel;
- CI de qualidade em PR/push:
  - `.github/workflows/quality-windows.yml`
  - `.github/workflows/quality-unix-packaging.yml`
  - o gate Windows valida `.exe` + `.msi`;
  - o gate Linux valida `.deb` + `.AppImage`.

## 6. Observacoes
- Sem assinatura configurada, o release ainda gera artefatos, mas com status `not-configured`.
- Para distribuicao corporativa, assinatura valida deve ser obrigatoria.
- O release publica tambem `LAIVE-OBS-SHA256SUMS.txt` com hash global de todos os arquivos.
- O release publica tambem `parity-release-gate-summary.json`; a promocao de canal usa esse artefato como evidencia obrigatoria do checklist de paridade.
- No empacotamento Windows, a verificacao de integridade falha imediatamente se o manifesto do bundle falhar, antes da verificacao externa.
- O build MSI tenta detectar WiX v3 no PATH e em instalacoes comuns do Windows. Se nao encontrar, faz bootstrap portatil via NuGet por padrao.
- Variaveis uteis para MSI:
  - `LAIVE_WIX_BIN_PATH`: caminho explicito para `heat.exe/candle.exe/light.exe`.
  - `LAIVE_WIX_VERSION`: versao do pacote NuGet `wix` para bootstrap portatil (default `3.14.1`).
  - `LAIVE_WIX_CACHE_DIR`: diretorio para cache do bootstrap portatil.
  - `LAIVE_DISABLE_WIX_AUTO_DOWNLOAD`: `1` para desativar bootstrap automatico.
