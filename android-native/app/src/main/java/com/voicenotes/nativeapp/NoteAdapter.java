package com.voicenotes.nativeapp;

import android.content.Context;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

/** 笔记列表的适配器，用 ListView + ViewHolder 复用行。 */
public class NoteAdapter extends BaseAdapter {

    private final Context context;
    private final List<Note> notes = new ArrayList<>();
    private final int activeColor;
    private final int idleColor;
    private final int text2Color;
    private final int mutedColor;

    public NoteAdapter(Context context) {
        this.context = context;
        this.activeColor = context.getColor(R.color.wave_active);
        this.idleColor = context.getColor(R.color.wave_idle);
        this.text2Color = context.getColor(R.color.text2);
        this.mutedColor = context.getColor(R.color.muted);
    }

    public void setNotes(List<Note> list) {
        notes.clear();
        if (list != null) notes.addAll(list);
        notifyDataSetChanged();
    }

    public Note getNote(int position) {
        return notes.get(position);
    }

    @Override
    public int getCount() {
        return notes.size();
    }

    @Override
    public Object getItem(int position) {
        return notes.get(position);
    }

    @Override
    public long getItemId(int position) {
        return notes.get(position).id;
    }

    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        ViewHolder holder;
        if (convertView == null) {
            convertView = LayoutInflater.from(context).inflate(R.layout.item_note, parent, false);
            holder = new ViewHolder();
            holder.title = convertView.findViewById(R.id.item_title);
            holder.star = convertView.findViewById(R.id.item_star);
            holder.excerpt = convertView.findViewById(R.id.item_excerpt);
            holder.wave = convertView.findViewById(R.id.item_wave);
            holder.duration = convertView.findViewById(R.id.item_duration);
            holder.date = convertView.findViewById(R.id.item_date);
            holder.tags = convertView.findViewById(R.id.item_tags);
            holder.wave.setColors(activeColor, idleColor);
            convertView.setTag(holder);
        } else {
            holder = (ViewHolder) convertView.getTag();
        }

        Note note = notes.get(position);

        holder.title.setText(note.displayTitle());
        holder.star.setVisibility(note.favorite ? View.VISIBLE : View.GONE);

        String excerpt = note.excerpt();
        if (excerpt.isEmpty()) {
            holder.excerpt.setText("（没有文字稿，点开可以补写或语音输入）");
            holder.excerpt.setTextColor(mutedColor);
        } else {
            holder.excerpt.setText(excerpt);
            holder.excerpt.setTextColor(text2Color);
        }

        holder.wave.setPeaks(Ui.parsePeaks(note.peaks));
        holder.wave.setProgress(0f);
        holder.duration.setText(Ui.formatDuration(note.durationMs));
        holder.date.setText(Ui.formatDate(note.createdAt));

        String[] tags = note.tagArray();
        if (tags.length == 0) {
            holder.tags.setVisibility(View.GONE);
        } else {
            StringBuilder sb = new StringBuilder();
            for (String tag : tags) {
                if (sb.length() > 0) sb.append("  ");
                sb.append('#').append(tag);
            }
            holder.tags.setText(sb.toString());
            holder.tags.setVisibility(View.VISIBLE);
        }
        return convertView;
    }

    private static class ViewHolder {
        TextView title;
        TextView star;
        TextView excerpt;
        WaveView wave;
        TextView duration;
        TextView date;
        TextView tags;
    }
}
