import React from 'react';

// /src/components/logo.js

/**
 * Logo component showing bilingual product name.
 * Props:
 *  - lang: 'en' | 'fr' | 'both' (default: 'both')
 *  - stacked: boolean -> if true, lines are stacked even when single language
 *  - className: optional extra class names
 */
const Logo = ({
    lang,
}) => {

    if (lang === 'en')
        return <div className="cioos-logo" style={{
            fontFamily: "Montserrat, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            display: 'flex',
            lineHeight: 0.8,
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.1rem',
            color: '#484848ff',
            width: "290px",
        }}>
            <span
                style={{
                    fontWeight: 200,
                    fontSize: '18px',
                }}
            >
                DATA
            </span>
            <span
                style={{
                    fontSize: '25px',
                    fontWeight: 400,
                }}
            >
                EXPLORER
            </span>
        </div>;
    else if (lang === 'fr')
        return <div className="cioos-logo" style={{
            fontFamily: "Montserrat, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            lineHeight: 0.9,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.1rem',
            width: "290px",
            color: '#484848ff'
        }}>
            <span
                style={{
                    fontWeight: 400,
                    fontSize: '25px',
                }}
            >
                EXPLORATEUR
            </span>
            <span
                style={{
                    fontSize: '18px',
                    fontWeight: 200,
                }}
            >
                DE DONNÉES
            </span>
        </div>;
    else {
        // Error case, raise error
        console.error(`Invalid lang prop for Logo component: ${lang}`);
        return null;
    }
};



export default Logo;