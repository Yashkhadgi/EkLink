This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## EkLink Docs

- [App integration guide](md/integration-guide.md): sign-in, tokens and claims for connected apps.
- [Change sync guide](md/sync-guide.md): how apps receive people, directory and approver changes.

## Admin Console

Admins (`super_admin`, `org_admin`, `institute_admin`, `department_admin`) open `/admin` to manage users, the directory, approver jobs, app sync and the audit log. Each admin only sees and changes people and units inside their own scope, and can only give roles below their own.

Account scripts (both are a dry run by default; add `--apply` to create accounts, and re-running skips people who already exist):

```bash
node --env-file=.env scripts/create-demo-users.mjs
node --env-file=.env scripts/create-staff-users.mjs
```

`create-demo-users.mjs` reads demo credentials from the TemplateOS `.env`; `create-staff-users.mjs` reads `data/staff-accounts-proposed.csv` (git-ignored). Temporary passwords are written only to git-ignored files and never printed.

## Tests

```bash
npm test
```

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
