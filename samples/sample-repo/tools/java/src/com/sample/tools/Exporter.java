package com.sample.tools;

import java.util.List;
import com.sample.tools.JsonFormatter;

public class Exporter {
    private final Formatter formatter = new JsonFormatter();

    public String export(List<String[]> notes) {
        StringBuilder out = new StringBuilder();
        for (String[] note : notes) {
            out.append(formatter.format(note[0], note[1]));
        }
        return out.toString();
    }

    public static void main(String[] args) {
        System.out.println(new Exporter().export(List.of()));
    }
}
