import { ConfigPlugin, withAppBuildGradle, withGradleProperties } from '@expo/config-plugins';

export const RHYTHM_QA_BUILD_MARKER = '// RHYTHM_QA_STANDALONE_BUILD';

export const RHYTHM_QA_STANDALONE_BLOCK = `
        // RHYTHM_QA_STANDALONE_BUILD
        qaStandalone {
            initWith release
            signingConfig signingConfigs.debug
            applicationIdSuffix ".qa"
            versionNameSuffix "-qa"
            minifyEnabled false
            shrinkResources false
            matchingFallbacks = ['release']
            externalNativeBuild {
                cmake {
                    arguments "-DCMAKE_OBJECT_PATH_MAX=200"
                }
            }
        }
`;

/**
 * Injects a standalone QA build type into android/app/build.gradle.
 *
 * Characteristics:
 * - Inherits release configuration (non-debuggable by default, meaning JS bundle & assets are embedded).
 * - Uses debug signingConfig (no production keystore required).
 * - Adds .qa applicationIdSuffix and -qa versionNameSuffix for co-existence with release builds.
 * - Disables Proguard minification and resource shrinking for fast, reliable QA packaging.
 */
export function injectQaBuildType(buildGradleContent: string): string {
  if (buildGradleContent.includes(RHYTHM_QA_BUILD_MARKER)) {
    return buildGradleContent;
  }

  // Anchor to buildTypes { block
  const buildTypesRegex = /(buildTypes\s*\{)/;
  const match = buildTypesRegex.exec(buildGradleContent);
  if (!match) {
    throw new Error('Unable to locate "buildTypes {" block in android/app/build.gradle');
  }

  const insertIndex = match.index + match[0].length;
  const before = buildGradleContent.slice(0, insertIndex);
  const after = buildGradleContent.slice(insertIndex);

  return `${before}${RHYTHM_QA_STANDALONE_BLOCK}${after}`;
}

function setGradleProperty(modResults: any[], key: string, value: string) {
  const existing = modResults.find(
    (item) => item.type === 'property' && item.key === key
  );
  if (existing && existing.type === 'property') {
    existing.value = value;
  } else {
    modResults.push({
      type: 'property',
      key,
      value,
    });
  }
}

const withRhythmAndroidQaBuild: ConfigPlugin = (config) => {
  config = withAppBuildGradle(config, (props) => {
    if (props.modResults.language !== 'groovy') {
      throw new Error('Rhythm QA build plugin expects Groovy build.gradle');
    }

    props.modResults.contents = injectQaBuildType(props.modResults.contents);
    return props;
  });

  config = withGradleProperties(config, (props) => {
    setGradleProperty(props.modResults, 'org.gradle.jvmargs', '-Xmx3072m -XX:MaxMetaspaceSize=512m');
    setGradleProperty(props.modResults, 'org.gradle.parallel', 'false');
    setGradleProperty(props.modResults, 'org.gradle.workers.max', '4');
    return props;
  });

  return config;
};

export default withRhythmAndroidQaBuild;
