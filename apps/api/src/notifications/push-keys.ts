import webpush from 'web-push';

/**
 * Prints a new VAPID key pair for .env (npm run push:keys -w apps/api). Do this once per server:
 * changing the keys later unsubscribes every browser. Keep the private key out of Git.
 */
const keys = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('VAPID_SUBJECT=mailto:team@your-domain   # the team address push services may contact');
