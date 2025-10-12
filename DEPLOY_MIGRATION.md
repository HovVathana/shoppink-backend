# Deploy Migration to Production (Vercel)

This guide explains how to run the database migration on your production database without losing data.

## What Changed
- Added `profilePicture` column to `users` table
- Added `returnedAt` column to `orders` table

## Option 1: Run Migration via Vercel CLI (Recommended)

### Step 1: Install Vercel CLI (if not already installed)
```bash
npm install -g vercel
```

### Step 2: Login to Vercel
```bash
vercel login
```

### Step 3: Link your project
```bash
cd /Users/vathana/Documents/code/shoppink/backend
vercel link
```

### Step 4: Get Production Database URL
```bash
vercel env pull .env.production
```

### Step 5: Run Migration on Production
```bash
# Set the production database URL temporarily
export DATABASE_URL="your_production_database_url_from_vercel"

# Run the migration
npx prisma migrate deploy
```

## Option 2: Run SQL Directly on Production Database

If you have direct access to your production PostgreSQL database:

### Connect to your database and run:
```sql
-- Add profilePicture column to users table
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "profilePicture" TEXT;

-- Add returnedAt column to orders table
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "returnedAt" TIMESTAMP(3);
```

## Option 3: Using Vercel Postgres Dashboard

1. Go to your Vercel dashboard
2. Navigate to your project → Storage → Your Postgres database
3. Click on "Query" tab
4. Run the SQL from Option 2 above

## Verify Migration

After running the migration, verify it worked:

```bash
# Connect to production DB
npx prisma db pull

# Check if columns exist
# You should see profilePicture in User model and returnedAt in Order model
```

## Post-Migration

1. Commit the migration file to git:
```bash
git add prisma/migrations/20251012153723_add_profile_picture_and_returned_at/
git commit -m "Add profilePicture and returnedAt migration"
git push
```

2. Deploy to Vercel:
```bash
vercel --prod
```

Or push to your connected git branch (main/master) and Vercel will auto-deploy.

## Troubleshooting

### Error: "column already exists"
This means the column was already added. You can safely ignore this or mark the migration as applied:
```bash
npx prisma migrate resolve --applied 20251012153723_add_profile_picture_and_returned_at
```

### Error: "Migration failed"
Check your DATABASE_URL is correct and you have write permissions on the production database.

### Error: "Table does not exist"
Make sure you're connected to the correct production database.

## Rollback (if needed)

If you need to rollback (remove the columns):
```sql
ALTER TABLE "users" DROP COLUMN IF EXISTS "profilePicture";
ALTER TABLE "orders" DROP COLUMN IF EXISTS "returnedAt";
```

⚠️ **Warning**: This will permanently delete data in these columns!
