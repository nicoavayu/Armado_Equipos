import React from 'react';
import { ArrowLeft, Check, Construction } from 'lucide-react';
import { Link } from 'react-router-dom';
import styles from './TorneosShell.module.css';

export default function TorneosPlaceholderPage({
  eyebrow,
  title,
  description,
  items,
}) {
  return (
    <section className={styles.placeholderPage}>
      <div className={styles.placeholderMark} aria-hidden="true">
        <Construction size={32} />
      </div>
      <span className={styles.eyebrow}>{eyebrow} · Foundation</span>
      <h1>{title}</h1>
      <p>{description}</p>
      <ul>
        {items.map((item) => (
          <li key={item}><Check size={16} aria-hidden="true" /> {item}</li>
        ))}
      </ul>
      <Link to="../inicio"><ArrowLeft size={16} /> Volver al inicio</Link>
    </section>
  );
}
