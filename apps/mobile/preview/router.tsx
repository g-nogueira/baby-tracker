export function Link(props: { href?: string; children?: import('react').ReactNode }) {
  return (
    <a href={props.href} style={{ color: '#817C76', fontSize: 14, padding: 16 }}>
      {props.children}
    </a>
  );
}
