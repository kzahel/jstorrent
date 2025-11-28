
import { SimpleTracker } from '../../test/helpers/simple-tracker';

async function main() {
    const tracker = new SimpleTracker({
        httpPort: 0,
        udpPort: 0,
    });

    const { httpPort } = await tracker.start();

    console.log(`HTTP tracker listening on port ${httpPort}`);
    console.log(`TRACKER_PORT=${httpPort}`);

    // Keep process alive
    await new Promise(() => { });
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
