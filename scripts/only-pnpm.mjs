const userAgent = process.env.npm_config_user_agent || '';

if (!userAgent.startsWith('pnpm/')) {
    console.error('\nThis project uses pnpm only.');
    console.error('Install dependencies with: pnpm install\n');
    process.exit(1);
}
