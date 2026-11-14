# Restaurant ERP System

A web-based Restaurant ERP System built to demonstrate how restaurant operations can be managed through a single dashboard.

The project includes restaurant management modules for employees, menus, orders, reservations, inventory, expenses, attendance, and more. It also features an AI-powered assistant that can answer questions about restaurant operations and perform selected actions using natural language.

**Live Demo:** https://erp-system-for-restaurant-business.vercel.app/

## Overview

This project was built as a practical demonstration of a restaurant management system, combining a frontend application, Supabase backend, database authentication, and AI integration.

The goal is to provide a centralized interface where restaurant owners and managers can manage everyday operations.

### Features

- **Dashboard:** Overview of restaurant activity, sales, orders, and operational statistics.
- **Employee Management:** Manage employee records and staff information.
- **Menu Management:** Manage menu categories, items, and prices.
- **Order Management:** Create and manage customer orders.
- **Reservations:** Manage restaurant reservations and table assignments.
- **Table Management:** View and manage dining tables.
- **Inventory:** Track inventory items and stock levels.
- **Suppliers:** Maintain supplier information.
- **Expenses:** Record and manage restaurant expenses.
- **Attendance:** Manage employee time entries.
- **Shift Management:** Manage employee shift assignments.
- **Leave Management:** Handle leave and replacement requests.
- **Wage Payments:** Maintain employee wage payment records.
- **Complaints:** Record and manage customer complaints.
- **Reports:** View operational information and summaries.
- **AI Assistant:** Ask questions about restaurant operations and use selected natural-language actions.

Some modules have more complete CRUD functionality than others. The project is continuously evolving.

## Technology Stack

| Technology | Purpose |
|---|---|
| HTML, CSS, JavaScript | Frontend |
| Supabase | Backend and database |
| PostgreSQL | Relational database |
| Supabase Auth | User authentication |
| Supabase Edge Functions | Secure server-side operations |
| Google Gemini API | AI assistant |
| Vercel | Frontend hosting |

## User Roles

The application uses restaurant-level roles:

| Role | Description |
|---|---|
| Owner | Manages the restaurant and its operations |
| Manager | Handles day-to-day restaurant operations |
| Staff | Uses shared staff access with restricted permissions |
| Platform Admin | Manages restaurants at the platform level |

The platform administrator is separate from restaurant membership roles.

Access to restaurant data is controlled through Supabase authentication and Row Level Security (RLS).

## Getting Started

Follow these steps to run the project locally.

### 1. Clone the repository

```bash
git clone YOUR_GITHUB_REPOSITORY_URL
```

Navigate into the project directory:

```bash
cd YOUR_PROJECT_DIRECTORY
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure Supabase

Create a Supabase project at:

https://supabase.com/

Create a `.env.local` file in the project root:

```env
VITE_SUPABASE_URL=YOUR_SUPABASE_PROJECT_URL
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_OR_PUBLISHABLE_KEY
```

Replace the placeholders with your own Supabase project credentials.

**Important:** Never put your Supabase service-role key in frontend environment variables or commit private credentials to GitHub.

### 4. Configure the database

The application requires its Supabase database schema, relationships, authentication setup, and Row Level Security policies.

Use the SQL migration or schema setup files included in the repository, if available, to configure your database.

Make sure the required tables and policies are created before running the application.

### 5. Configure the AI assistant (optional)

The AI assistant uses Google Gemini through a Supabase Edge Function.

Create a Gemini API key:

https://aistudio.google.com/

Configure the key as a Supabase Edge Function secret:

```bash
npx supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Deploy the assistant function:

```bash
npx supabase functions deploy erp-assistant
```

The assistant uses server-side API access. Do not expose your Gemini API key in frontend code.

### 6. Run the application

```bash
npm run dev
```

Open the local URL displayed by Vite in your terminal.

### 7. Build for production

```bash
npm run build
```

## Demo Data

The repository includes a demo data seeding script for the Demo Restaurant.

To seed the demo data:

```bash
npm run seed:demo
```

The seed script uses deterministic record IDs and is designed to be repeatable.

It populates sample operational data such as:

- Employees
- Menu categories and menu items
- Dining tables
- Orders and order items
- Reservations
- Inventory items
- Suppliers
- Expenses
- Attendance and shift assignments
- Leave and replacement requests
- Wage payments
- Complaints

**Important:** Review the seed script and configure its required Supabase connection securely before running it. Only run it against a database you intend to populate with demo data.

## AI Assistant

The project includes an AI assistant powered by Google Gemini.

It is designed to help users interact with restaurant information using natural language.

Examples:

- "How many employees do we have?"
- "Show me today's orders."
- "Which inventory items are running low?"
- "Create a reservation for four people."
- "Prepare an order for table 14."

The assistant currently supports a predefined set of read operations and selected record-creation workflows.

Write operations use a confirmation process before saving records. The assistant is not an unrestricted database agent and cannot execute arbitrary SQL.

## Security

Security is an important part of the project architecture.

- Supabase Auth handles user authentication.
- Restaurant membership determines the user's restaurant context and role.
- PostgreSQL Row Level Security protects tenant data.
- Restaurant queries are scoped to the authenticated membership.
- Privileged operations are handled server-side.
- API secrets are kept outside the frontend.
- The AI assistant uses predefined operations rather than unrestricted database access.

When deploying your own instance, review all database policies, Edge Functions, and environment variables.

## Project Status

This is a demonstration and learning project.

It is intended to showcase:
- Restaurant ERP workflows.
- Multi-tenant application architecture.
- Supabase authentication and database integration.
- Role-based access control.
- AI-assisted business operations.
- Frontend and backend integration.

Not every module has complete CRUD functionality, and the application has not been represented as a fully production-hardened commercial ERP.

Before using it in a real restaurant, additional testing, security review, backups, monitoring, and operational hardening are necessary.

## Contributing

Contributions, suggestions, and improvements are welcome.

If you want to contribute:

1. Fork the repository.
2. Create a feature branch.
3. Make your changes.
4. Test your changes locally.
5. Submit a pull request with a clear description.

## License

Choose and add an appropriate open-source license before distributing or accepting contributions. Until a license is added, the repository should not be assumed to grant permission to reuse or redistribute its code.

---

**Built as a practical restaurant ERP showcase project.**
