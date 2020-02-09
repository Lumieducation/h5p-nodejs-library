import * as fsExtra from 'fs-extra';
import * as path from 'path';

import EditorConfig from '../../src/implementation/EditorConfig';
import PackageValidator from '../../src/PackageValidator';
import TranslationService from '../../src/TranslationService';

describe('validate all H5P files from the Hub', () => {
    const directory = `${path.resolve('')}/test/data/hub-content/`;
    let files;
    try {
        files = fsExtra.readdirSync(directory);
    } catch {
        throw new Error(
            "The directory test/data/hub-content does not exist. Execute 'npm run download:content' to fetch example data from the H5P Hub!"
        );
    }

    for (const file of files.filter(f => f.endsWith('.h5p'))) {
        it(`${file}`, async () => {
            const englishStrings = await fsExtra.readJSON(
                `${path.resolve('')}/src/translations/en.json`
            );
            const translationService = new TranslationService(
                englishStrings,
                englishStrings
            );
            const config = new EditorConfig(null);
            config.contentWhitelist += ' html';
            const validator = new PackageValidator(translationService, config);
            await expect(
                validator.validatePackage(`${directory}/${file}`)
            ).resolves.toBeDefined();
        });
    }
});
