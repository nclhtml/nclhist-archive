import React, { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { useLanguage } from './LanguageContext.jsx';

export default function SiteNavigation({ isAdmin, isPhoneLayout }) {
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const navRef = useRef(null);

  const groups = [
    {
      label: 'DSE-related',
      links: [
        { to: '/', label: 'Search Engine' },
        { to: '/trend', label: 'DSE Trend Analysis' }
      ]
    },
    {
      label: 'Study Progress',
      links: [
        { to: '/dashboard', label: 'Student Dashboard' },
        { to: '/list', label: 'Saved Lists' },
        { to: '/exercises', label: 'Interactive Exercises' }
      ]
    },
    ...(isAdmin
      ? [
          {
            label: 'Admin Tools',
            links: [
              { to: '/pdf', label: 'PDF Tools' },
              { to: '/lottery', label: 'Lottery Machine' }
            ]
          },
          {
            label: 'Management Tools',
            links: [
              { to: '/record', label: 'Record Management' },
              { to: '/marks', label: 'Marks Management' },
              { to: '/timetable', label: 'Timetable' }
            ]
          }
        ]
      : [])
  ];

  const activePath = location.pathname.startsWith('/exercise')
    ? '/exercises'
    : location.pathname;

  const knownPath = groups.some(group =>
    group.links.some(link => link.to === activePath)
  );

  useEffect(() => {
    navRef.current?.querySelectorAll('details[open]').forEach(detail => {
      detail.open = false;
    });
  }, [location.pathname, location.search, isPhoneLayout]);

  useEffect(() => {
    const closeMenus = event => {
      const nav = navRef.current;
      if (!nav) return;

      if (
        event.type === 'keydown'
          ? event.key === 'Escape'
          : !nav.contains(event.target)
      ) {
        nav.querySelectorAll('details[open]').forEach(detail => {
          detail.open = false;
        });
      }
    };

    document.addEventListener('pointerdown', closeMenus);
    document.addEventListener('keydown', closeMenus);

    return () => {
      document.removeEventListener('pointerdown', closeMenus);
      document.removeEventListener('keydown', closeMenus);
    };
  }, []);

  return (
    <nav ref={navRef} className="site-navigation" aria-label="Main navigation">
      {isPhoneLayout ? (
        <label className="site-mobile-navigation">
          <span>{t('Go to')}</span>

          <select
            aria-label="Choose a page"
            value={knownPath ? activePath : ''}
            onChange={event => {
              if (event.target.value) navigate(event.target.value);
            }}
          >
            <option value="" disabled>
              {t('Choose a page')}
            </option>

            {groups.map(group => (
              <optgroup key={group.label} label={t(group.label)}>
                {group.links.map(link => (
                  <option key={link.to} value={link.to}>
                    {t(link.label)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : (
        <div className="site-desktop-navigation">
          {groups.map(group => {
            const active = group.links.some(link => link.to === activePath);

            return (
              <details
                key={group.label}
                className={`site-nav-group ${active ? 'is-active' : ''}`}
                onToggle={event => {
                  const current = event.currentTarget;
                  if (!current.open) return;

                  navRef.current
                    ?.querySelectorAll('details[open]')
                    .forEach(detail => {
                      if (detail !== current) detail.open = false;
                    });
                }}
              >
                <summary>
                  {t(group.label)}
                  <ChevronDown size={14} />
                </summary>

                <div className="site-nav-dropdown">
                  {group.links.map(link => (
                    <Link
                      key={link.to}
                      to={link.to}
                      aria-current={activePath === link.to ? 'page' : undefined}
                      className={activePath === link.to ? 'is-active' : ''}
                      onClick={() => {
                        navRef.current
                          ?.querySelectorAll('details[open]')
                          .forEach(detail => {
                            detail.open = false;
                          });
                      }}
                    >
                      {t(link.label)}
                    </Link>
                  ))}
                </div>
              </details>
            );
          })}
        </div>
      )}
    </nav>
  );
}