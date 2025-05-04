import sqlite3

def upgrade_db():
    conn = sqlite3.connect("waldo.db")
    c = conn.cursor()

    def safe_add_column(cursor, sql, label):
        try:
            cursor.execute(sql)
            print(f"➕ Added column: {label}")
        except sqlite3.OperationalError:
            print(f"✅ Column already exists: {label}")

    safe_add_column(c, "ALTER TABLE meme_tweets ADD COLUMN reward_tier INTEGER", "reward_tier")
    safe_add_column(c, "ALTER TABLE meme_tweets ADD COLUMN waldo_amount REAL", "waldo_amount")
    safe_add_column(c, "ALTER TABLE meme_tweets ADD COLUMN reward_type TEXT", "reward_type")
    safe_add_column(c, "ALTER TABLE meme_tweets ADD COLUMN claimed BOOLEAN DEFAULT 0", "claimed")

    conn.commit()
    conn.close()
    print("\n✅ Database upgrade complete.")

if __name__ == "__main__":
    upgrade_db()
