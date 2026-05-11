# Susan Agent

Susan is an automated agent that handles PO (Purchase Order) breakdown emails for the production team.

## Features

- **PO Breakdown Email**: Automatically generates and sends detailed PO breakdown emails based on style numbers
- **Google Sheets Integration**: Reads PO data from the Production & PO Database
- **Email Automation**: Sends formatted breakdown emails to the production team

## Setup

1. Clone this repository
2. Install dependencies: `npm install`
3. Set up environment variables:
   - `EMAIL_USER`: Gmail address for sending emails
   - `EMAIL_PASS`: Gmail app password
   - `GOOGLE_SERVICE_ACCOUNT_JSON`: Google Service Account credentials

## Usage

### Manual Execution
```bash
npm run po-breakdown [style-number]
```

### GitHub Actions
Trigger the workflow from GitHub Actions with a style number input.

## Workflows

- `po-breakdown-email.yml`: Generates and sends PO breakdown emails

## Scripts

- `scripts/po-breakdown-email.js`: Main script for PO breakdown email generation