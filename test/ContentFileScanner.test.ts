import * as fsExtra from 'fs-extra';
import * as path from 'path';
import { withDir } from 'tmp-promise';

import { ContentFileScanner } from '../src/ContentFileScanner';
import ContentManager from '../src/ContentManager';
import LibraryManager from '../src/LibraryManager';
import PackageImporter from '../src/PackageImporter';
import TranslationService from '../src/TranslationService';
import { ContentId, IUser } from '../src/types';

import EditorConfig from '../examples/implementation/EditorConfig';
import FileContentStorage from '../examples/implementation/FileContentStorage';
import FileLibraryStorage from '../examples/implementation/FileLibraryStorage';
import User from '../examples/implementation/User';

describe('ContentFileScanner', () => {
    async function createContentFileScanner(
        file: string,
        user: IUser,
        tmpDirPath: string
    ): Promise<{
        contentId: ContentId;
        contentManager: ContentManager;
        contentScanner: ContentFileScanner;
    }> {
        // create required dependencies
        const contentDir = path.join(tmpDirPath, 'content');
        const libraryDir = path.join(tmpDirPath, 'libraries');
        await fsExtra.ensureDir(contentDir);
        await fsExtra.ensureDir(libraryDir);

        const contentManager = new ContentManager(
            new FileContentStorage(contentDir)
        );
        const libraryManager = new LibraryManager(
            new FileLibraryStorage(libraryDir)
        );

        // install content & libraries
        const packageImporter = new PackageImporter(
            libraryManager,
            new TranslationService({}),
            new EditorConfig(null),
            contentManager
        );
        const contentId = await packageImporter.addPackageLibrariesAndContent(
            file,
            user
        );

        // create ContentScanner
        return {
            contentId,
            contentManager,
            contentScanner: new ContentFileScanner(
                contentManager,
                libraryManager
            )
        };
    }

    it('finds the image in H5P.Blanks example', async () => {
        await withDir(
            async ({ path: tmpDirPath }) => {
                const user = new User();
                user.canUpdateAndInstallLibraries = true;

                const {
                    contentScanner,
                    contentId
                } = await createContentFileScanner(
                    path.resolve('test/data/hub-content/H5P.Blanks.h5p'),
                    user,
                    tmpDirPath
                );

                const foundImages = await contentScanner.scanForFiles(
                    contentId,
                    user
                );

                expect(foundImages.length).toEqual(1);
                expect(foundImages[0].path).toEqual(
                    'images/file-5885c18261805.jpg'
                );
            },
            { keep: false, unsafeCleanup: true }
        );
    });

    // scan all Hub examples for their file references and compare to directory contents
    const directory = path.resolve('test/data/hub-content/');
    let files;
    try {
        files = fsExtra.readdirSync(directory);
    } catch {
        throw new Error(
            "The directory test/data/hub-content does not exist. Execute 'npm run download:content' to fetch example data from the H5P Hub!"
        );
    }

    for (const file of files.filter(f => f.endsWith('.h5p'))) {
        it(`finds all files in ${file}`, async () => {
            await withDir(
                async ({ path: tmpDirPath }) => {
                    const user = new User();
                    user.canUpdateAndInstallLibraries = true;

                    const {
                        contentId,
                        contentManager,
                        contentScanner
                    } = await createContentFileScanner(
                        path.join(directory, file),
                        user,
                        tmpDirPath
                    );

                    const foundFiles = await contentScanner.scanForFiles(
                        contentId,
                        user
                    );

                    const fileSystemFiles = await contentManager.getContentFiles(
                        contentId,
                        user
                    );
                    expect(foundFiles.map(f => f.path).sort()).toEqual(
                        fileSystemFiles.sort()
                    );
                },
                { keep: false, unsafeCleanup: true }
            );
        });
    }
});
