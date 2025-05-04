import sqlite3

def view_tweets(limit=50):
    conn = sqlite3.connect("waldo.db")
    c = conn.cursor()

    c.execute(
        f"""
        SELECT tweet_id, author_id, text, likes, retweets, created_at
        FROM meme_tweets
        ORDER BY created_at DESC
        LIMIT ?
        """, (limit,)
    )
    rows = c.fetchall()

    if not rows:
        print("📭 No tweets found in the database.")
        return

    print(f"📄 Displaying latest {len(rows)} tweet(s):\n")

    for row in rows:
        print(f"🧵 Tweet ID: {row[0]}")
        print(f"👤 Author ID: {row[1]}")
        text = row[2].replace("\n", " ")
        print(f"💬 Text: {text[:200]}{'...' if len(text) > 200 else ''}")
        print(f"❤️ Likes: {row[3]}  🔁 Retweets: {row[4]}")
        print(f"📅 Created At: {row[5]}")
        print("-" * 40)

    conn.close()

if __name__ == "__main__":
    view_tweets()
