package carpool.api;

import io.karatelabs.core.Runner;
import io.karatelabs.core.SuiteResult;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

// Runs against an already running backend with the seeded test users (see DEV.md).
class ApiTest {

    @Test
    void testAll() {
        SuiteResult result = Runner.path("classpath:carpool/api")
                .systemProperty("baseUrl", System.getProperty("baseUrl", "http://localhost:8080"))
                .parallel(3);
        assertTrue(result.getScenarioCount() > 0, "no scenarios were found");
        assertEquals(0, result.getScenarioFailedCount(), String.join("\n", result.getErrors()));
    }
}
