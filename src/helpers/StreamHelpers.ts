import { Stream } from 'stream';

/**
 * Returns the contents of a stream as a string
 * @param  stream the stream to read
 * @returns {Promise<string>}
 */
export function streamToString(stream: Stream): Promise<string> {
    /* from https://stackoverflow.com/questions/10623798/read-contents-of-node-js-stream-into-a-string-variable */
    const chunks = [];
    return new Promise((resolve, reject) => {
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}
