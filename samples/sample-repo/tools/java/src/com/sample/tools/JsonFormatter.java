package com.sample.tools;

public class JsonFormatter implements Formatter {
    @Override
    public String format(String title, String body) {
        return "{title:" + escape(title) + ",body:" + escape(body) + "}";
    }

    private String escape(String value) {
        return value.trim();
    }
}
