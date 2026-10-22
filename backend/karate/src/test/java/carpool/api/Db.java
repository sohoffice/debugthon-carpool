package carpool.api;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

/**
 * SQL fixtures for feature files. Use it only for data no REST endpoint can write
 * (accounts, habitual profiles); everything else goes through the API.
 */
public class Db {

    private static final String URL = System.getProperty("dbUrl", "jdbc:postgresql://localhost:5432/carpool");
    private static final String USER = System.getProperty("dbUser", "carpool");
    private static final String PASSWORD = System.getProperty("dbPassword", "carpool");

    /** Runs a statement and returns the number of rows changed. */
    public static int exec(String sql, Object... params) throws SQLException {
        try (Connection c = DriverManager.getConnection(URL, USER, PASSWORD);
             PreparedStatement ps = prepare(c, sql, params)) {
            return ps.executeUpdate();
        }
    }

    /** Runs a statement that returns one number, e.g. {@code INSERT ... RETURNING id}. */
    public static long queryLong(String sql, Object... params) throws SQLException {
        try (Connection c = DriverManager.getConnection(URL, USER, PASSWORD);
             PreparedStatement ps = prepare(c, sql, params);
             ResultSet rs = ps.executeQuery()) {
            rs.next();
            return rs.getLong(1);
        }
    }

    /** Runs a statement for its side effect and ignores what it returns, e.g. {@code SELECT some_function()}. */
    public static void query(String sql, Object... params) throws SQLException {
        try (Connection c = DriverManager.getConnection(URL, USER, PASSWORD);
             PreparedStatement ps = prepare(c, sql, params)) {
            ps.execute();
        }
    }

    private static PreparedStatement prepare(Connection c, String sql, Object[] params) throws SQLException {
        PreparedStatement ps = c.prepareStatement(sql);
        for (int i = 0; i < params.length; i++) {
            ps.setObject(i + 1, params[i]);
        }
        return ps;
    }
}
