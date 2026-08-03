package app.gomsinlog;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.io.File;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import javax.xml.parsers.ParserConfigurationException;
import org.junit.Test;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.SAXException;

/**
 * JVM unit tests over the shipped Android configuration.
 *
 * These run in `./gradlew :app:testDebugUnitTest`, need no device or emulator,
 * and are the Android-side twin of src/lib/nativeConfig.test.ts. They read the
 * real source manifest rather than a copy, so a hand edit that widens the deep
 * link or adds a permission fails the build.
 */
public class NativeConfigTest {

    private static final String ANDROID_NS = "http://schemas.android.com/apk/res/android";

    private Document parse(String relativePath) throws IOException, SAXException, ParserConfigurationException {
        File file = new File(relativePath);
        assertTrue(relativePath + " must exist", file.isFile());
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        DocumentBuilder builder = factory.newDocumentBuilder();
        return builder.parse(file);
    }

    private String read(String relativePath) throws IOException {
        return new String(Files.readAllBytes(new File(relativePath).toPath()), StandardCharsets.UTF_8);
    }

    private Document manifest() throws IOException, SAXException, ParserConfigurationException {
        return parse("src/main/AndroidManifest.xml");
    }

    @Test
    public void declaresOnlyThePermissionsTheCodeProves() throws Exception {
        NodeList nodes = manifest().getElementsByTagName("uses-permission");
        List<String> declared = new ArrayList<>();
        for (int i = 0; i < nodes.getLength(); i++) {
            declared.add(((Element) nodes.item(i)).getAttributeNS(ANDROID_NS, "name"));
        }
        java.util.Collections.sort(declared);

        List<String> expected = Arrays.asList(
            "android.permission.INTERNET",
            "android.permission.MODIFY_AUDIO_SETTINGS",
            "android.permission.RECORD_AUDIO"
        );
        assertEquals(expected, declared);
    }

    @Test
    public void declaresNoForbiddenPermissionAnywhereInTheManifest() throws Exception {
        String raw = read("src/main/AndroidManifest.xml");
        String[] forbidden = {
            "android.permission.CAMERA",
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.ACCESS_COARSE_LOCATION",
            "android.permission.ACCESS_BACKGROUND_LOCATION",
            "android.permission.READ_CONTACTS",
            "android.permission.WRITE_CONTACTS",
            "android.permission.GET_ACCOUNTS",
            "android.permission.READ_PHONE_STATE",
            "android.permission.READ_MEDIA_IMAGES",
            "android.permission.READ_MEDIA_VIDEO",
            "android.permission.READ_MEDIA_AUDIO",
            "android.permission.READ_EXTERNAL_STORAGE",
            "android.permission.WRITE_EXTERNAL_STORAGE",
            "com.google.android.gms.permission.AD_ID"
        };
        for (String permission : forbidden) {
            // The justification comment names CAMERA and the media permissions on
            // purpose, so match only a real declaration.
            assertFalse(
                permission + " must not be declared",
                raw.contains("<uses-permission android:name=\"" + permission + "\"")
            );
        }
    }

    @Test
    public void everyComponentDeclaresExportedExplicitly() throws Exception {
        Document doc = manifest();
        for (String tag : new String[] { "activity", "activity-alias", "service", "receiver", "provider" }) {
            NodeList nodes = doc.getElementsByTagName(tag);
            for (int i = 0; i < nodes.getLength(); i++) {
                Element element = (Element) nodes.item(i);
                String name = element.getAttributeNS(ANDROID_NS, "name");
                assertTrue(
                    tag + " " + name + " must declare android:exported explicitly",
                    element.hasAttributeNS(ANDROID_NS, "exported")
                );
            }
        }
    }

    @Test
    public void registersExactlyOneDeepLinkAndOnlyTheCallbackRoute() throws Exception {
        Document doc = manifest();
        NodeList filters = doc.getElementsByTagName("intent-filter");
        int viewFilters = 0;
        for (int i = 0; i < filters.getLength(); i++) {
            Element filter = (Element) filters.item(i);
            if (!hasChildWithName(filter, "action", "android.intent.action.VIEW")) continue;
            viewFilters++;

            NodeList data = filter.getElementsByTagName("data");
            assertEquals("the VIEW filter must carry exactly one <data>", 1, data.getLength());
            Element only = (Element) data.item(0);
            assertEquals("gomsinlog", only.getAttributeNS(ANDROID_NS, "scheme"));
            assertEquals("auth", only.getAttributeNS(ANDROID_NS, "host"));
            assertEquals("/callback", only.getAttributeNS(ANDROID_NS, "path"));
            // pathPrefix/pathPattern would widen the filter back to "any path".
            assertFalse(only.hasAttributeNS(ANDROID_NS, "pathPrefix"));
            assertFalse(only.hasAttributeNS(ANDROID_NS, "pathPattern"));
            assertFalse(only.hasAttributeNS(ANDROID_NS, "pathSuffix"));

            assertTrue(hasChildWithName(filter, "category", "android.intent.category.BROWSABLE"));
            assertTrue(hasChildWithName(filter, "category", "android.intent.category.DEFAULT"));
        }
        assertEquals("exactly one VIEW intent-filter", 1, viewFilters);
    }

    @Test
    public void backupAndDataExtractionAreClosed() throws Exception {
        Element application = (Element) manifest().getElementsByTagName("application").item(0);
        assertEquals("false", application.getAttributeNS(ANDROID_NS, "allowBackup"));
        assertEquals("false", application.getAttributeNS(ANDROID_NS, "usesCleartextTraffic"));
        assertEquals("@xml/backup_rules", application.getAttributeNS(ANDROID_NS, "fullBackupContent"));
        assertEquals("@xml/data_extraction_rules", application.getAttributeNS(ANDROID_NS, "dataExtractionRules"));
        assertEquals(
            "@xml/network_security_config",
            application.getAttributeNS(ANDROID_NS, "networkSecurityConfig")
        );

        Document rules = parse("src/main/res/xml/data_extraction_rules.xml");
        for (String section : new String[] { "cloud-backup", "device-transfer" }) {
            NodeList sections = rules.getElementsByTagName(section);
            assertEquals(section + " must be present exactly once", 1, sections.getLength());
            Element element = (Element) sections.item(0);
            assertEquals("nothing may be included in " + section, 0, element.getElementsByTagName("include").getLength());
            assertTrue(
                section + " must exclude the app root",
                excludesDomain(element, "root")
            );
        }
    }

    @Test
    public void cleartextIsDisabledAndUserCertificateStoreIsNotTrusted() throws Exception {
        Document config = parse("src/main/res/xml/network_security_config.xml");
        Element base = (Element) config.getElementsByTagName("base-config").item(0);
        assertEquals("false", base.getAttribute("cleartextTrafficPermitted"));

        NodeList certificates = config.getElementsByTagName("certificates");
        assertEquals(1, certificates.getLength());
        // Network-security-config attributes are unprefixed, NOT in the android
        // namespace, so this reads `src` rather than `android:src`. Asserting the
        // namespaced attribute instead compares "" to "" and passes even after
        // someone adds <certificates src="user" />.
        assertEquals("system", ((Element) certificates.item(0)).getAttribute("src"));

        // No per-domain escape hatch may reintroduce cleartext.
        assertEquals(0, config.getElementsByTagName("domain-config").getLength());
        assertEquals(0, config.getElementsByTagName("debug-overrides").getLength());
    }

    @Test
    public void releaseBuildIsNotDebuggableAndCarriesNoSigningMaterial() throws Exception {
        String gradle = read("build.gradle");
        assertTrue(gradle.contains("debuggable false"));
        assertFalse("no signing config may be committed", gradle.contains("signingConfig"));
        assertFalse(gradle.contains("signingConfigs"));
        assertFalse(gradle.contains("storePassword"));
        assertFalse(gradle.contains("storeFile"));
        assertFalse(gradle.contains("keyAlias"));
        assertFalse(gradle.contains("keyPassword"));
        assertFalse(new File("../keystore.properties").exists());
        assertFalse(new File("keystore.properties").exists());
    }

    @Test
    public void displayNameAndApplicationIdAreTheStoreValues() throws Exception {
        assertTrue(read("build.gradle").contains("applicationId \"app.gomsinlog\""));
        // Escaped rather than written literally so the assertion cannot pass by
        // accident if this file is ever read with the wrong charset:
        // U+ACF0 U+C2E0 U+B85C U+ADF8 == 곰신로그.
        String label = "\uACF0\uC2E0\uB85C\uADF8";
        String strings = read("src/main/res/values/strings.xml");
        assertTrue("app_name must be the store label", strings.contains(">" + label + "<"));
        assertTrue(
            "the launcher activity label must be the store label",
            strings.contains("<string name=\"title_activity_main\">" + label + "</string>")
        );
        // The Capacitor template leaves `custom_url_scheme` set to the appId. The
        // real scheme is `gomsinlog`, and this string is what a future manifest
        // edit or plugin would resolve, so it must not disagree with
        // capacitor.config.ts.
        assertTrue(
            "custom_url_scheme must be the registered scheme",
            strings.contains("<string name=\"custom_url_scheme\">gomsinlog</string>")
        );
    }

    private boolean excludesDomain(Element parent, String domain) {
        NodeList excludes = parent.getElementsByTagName("exclude");
        for (int i = 0; i < excludes.getLength(); i++) {
            if (domain.equals(((Element) excludes.item(i)).getAttribute("domain"))) return true;
        }
        return false;
    }

    private boolean hasChildWithName(Element filter, String tag, String name) {
        NodeList nodes = filter.getElementsByTagName(tag);
        for (int i = 0; i < nodes.getLength(); i++) {
            Node node = nodes.item(i);
            if (node instanceof Element && name.equals(((Element) node).getAttributeNS(ANDROID_NS, "name"))) {
                return true;
            }
        }
        return false;
    }
}
