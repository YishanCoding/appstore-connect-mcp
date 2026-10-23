# App Store Connect MCP

A Model Context Protocol (MCP) server for interacting with Apple's App Store Connect API. This tool enables automated management of iOS apps, builds, TestFlight beta testing, and user access control through a standardized interface.

## Features

### Authentication
- Store and validate App Store Connect API credentials
- Automatic JWT token generation for API requests

### App Management
- List all apps in your account
- Get app details by ID or bundle ID
- Retrieve app metadata and configuration

### Build Management
- List builds for any app
- Get specific build details
- Find the latest build for an app
- Filter builds by version or processing state

### TestFlight Integration
- List and manage beta groups
- Add builds to beta groups
- Add beta testers to groups
- Configure testing access

### User Management
- List team members and their roles
- Invite new users to the team
- Manage user permissions and access

### In-App Purchases
- List In-App Purchases for an app
- Get In-App Purchase details
- List subscription groups for an app

### App Asset Library (ASC API 4.5.1)
- List per-app images, reference data, and version or custom product page placements
- Upload images once, place them on localizations, and order screenshots by placement group
- `ascli screenshot upload` uses App Asset Library by default; legacy screenshot sets require `--legacy`
- `ascli cpp create` uploads CPP screenshots as library placements, with a reference-validated group and count; `--legacy` retains deprecated screenshot sets
- `ascli screenshot upload --app-custom-product-page-localization-id <id>` appends or replaces screenshots on an existing CPP localization
- `ACCESS_TO_REPORTS` is deprecated and rejected by user invite and role update commands

See [CLI usage](docs/cli-usage.md#app-asset-library-截图流程asc-api-451) for commands and dry-run examples.

## Prerequisites

- Node.js 18.0.0 or higher
- App Store Connect API credentials:
  - API Key ID
  - Issuer ID (Team ID) — only for team keys; omit it when using an Individual API Key
  - Private Key (.p8 file)

## Installation

Build the CLI and link it:

```bash
bun run build:cli && ln -sf "$PWD/dist/ascli" /Users/yishan/.local/bin/ascli
```

### Claude Code

```bash
claude mcp add appstore-connect-mcp -- npx appstore-connect-mcp
```

## Setup

1. Generate an App Store Connect API key:
   - Go to [App Store Connect](https://appstoreconnect.apple.com)
   - Navigate to Users and Access → Keys
   - Create a new key with desired permissions
   - Download the .p8 private key file
   - Note your Key ID and Issuer ID

   Individual API Key: an admin enables "Generate Individual API Keys" for your user, then you open your profile → Individual API Key → Generate. Download the .p8 and note the Key ID. Leave `APP_STORE_CONNECT_ISSUER_ID` unset — the JWT is then signed with `sub: "user"` instead of `iss`. The key has the same permissions as your account.

   ```bash
   export APP_STORE_CONNECT_KEY_ID=XXXXXXXXXX
   export APP_STORE_CONNECT_PRIVATE_KEY_PATH=/path/to/AuthKey_XXXXXXXXXX.p8
   ascli auth check
   ```

2. Configure the MCP server in Claude Desktop:
   ```bash
   npm run mcp:add
   ```

   Or manually add to your Claude configuration:
   ```json
   {
     "mcpServers": {
       "appstore-connect-mcp": {
         "command": "node",
         "args": ["/path/to/appstore-connect-mcp/dist/index.js"]
       }
     }
   }
   ```

## Usage

### 1. Store Credentials

First, store your App Store Connect credentials:

```
appstore_store_credentials
- keyId: Your API Key ID
- issuerId: Your Team ID
- privateKey: Contents of your .p8 file (include BEGIN/END markers)
```

### 2. Validate Credentials

Verify your credentials are working:

```
appstore_validate_credentials
```

### 3. Available Tools

#### Apps
- `appstore_list_apps` - List all apps
- `appstore_get_app` - Get app by ID or bundle ID

#### Builds
- `appstore_list_builds` - List builds for an app
- `appstore_get_build` - Get specific build details
- `appstore_get_latest_build` - Get the most recent build

#### TestFlight
- `appstore_list_beta_groups` - List beta testing groups
- `appstore_add_build_to_beta_group` - Add build to testing
- `appstore_add_beta_tester` - Add new beta tester

#### Users
- `appstore_list_users` - List team members
- `appstore_invite_user` - Invite new team member

#### In-App Purchases
- `appstore_list_in_app_purchases` - List In-App Purchases for an app
- `appstore_get_in_app_purchase` - Get a specific In-App Purchase
- `appstore_list_subscription_groups` - List subscription groups for an app

## API Client Generation

To regenerate the API client from OpenAPI spec:

```bash
npm run generate:api
```

## Security

- Credentials are stored in memory only during the session
- Private keys are validated before use
- JWT tokens are generated with 20-minute expiration
- All API requests use HTTPS

## Error Handling

The server provides detailed error messages for common issues:
- Invalid credentials
- Missing permissions
- API rate limits
- Network errors

## License

MIT
